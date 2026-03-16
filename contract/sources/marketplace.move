/// Marketplace — handles dataset purchases, seller earnings, and platform fees.
///
/// Architecture:
/// - MarketplaceState is a named singleton Object that also acts as an APT escrow.
///   All purchase payments flow into this Object's CoinStore; seller earnings and
///   platform fees are tracked as u64 balances within MarketplaceState.
/// - Buyers get a PurchasedDatasets resource stored under their own account address
///   that maps dataset_id → purchase timestamp.
/// - Sellers call withdraw_earnings() to pull their accumulated APT.
/// - The admin calls withdraw_platform_earnings() to pull platform fee APT.
module marketplace_addr::marketplace {
    use std::signer;
    use aptos_framework::aptos_coin::AptosCoin;
    use aptos_framework::coin;
    use aptos_framework::event;
    use aptos_framework::object::{Self, ExtendRef};
    use aptos_framework::table::{Self, Table};
    use aptos_framework::timestamp;
    use marketplace_addr::dataset_registry;

    // ============ Error Codes ============

    const E_ALREADY_PURCHASED: u64 = 1;
    const E_DATASET_NOT_ACTIVE: u64 = 2;
    const E_NOT_ADMIN: u64 = 3;
    const E_NO_EARNINGS: u64 = 4;
    const E_INVALID_FEE: u64 = 5;
    const E_SELF_PURCHASE: u64 = 6;
    const E_NO_PLATFORM_EARNINGS: u64 = 7;
    const E_ZERO_ADDRESS: u64 = 8;

    // ============ Constants ============

    const MARKETPLACE_SEED: vector<u8> = b"ai_dataset_marketplace_v1";
    /// Default platform fee: 2.5% (250 basis points).
    const DEFAULT_PLATFORM_FEE_BPS: u64 = 250;
    /// Maximum platform fee: 10%.
    const MAX_PLATFORM_FEE_BPS: u64 = 1000;

    // ============ Events ============

    #[event]
    struct DatasetPurchased has drop, store {
        buyer: address,
        seller: address,
        dataset_addr: address,
        dataset_id: u64,
        price_paid: u64,
        platform_fee: u64,
        purchased_at: u64,
    }

    #[event]
    struct EarningsWithdrawn has drop, store {
        seller: address,
        amount: u64,
        withdrawn_at: u64,
    }

    #[event]
    struct PlatformEarningsWithdrawn has drop, store {
        admin: address,
        amount: u64,
        withdrawn_at: u64,
    }

    #[event]
    struct PlatformFeeUpdated has drop, store {
        old_fee_bps: u64,
        new_fee_bps: u64,
    }

    // ============ Structs ============

    /// Singleton marketplace state. The corresponding Object's CoinStore holds
    /// all escrowed APT (platform fees + seller earnings not yet withdrawn).
    ///
    /// Invariant: coin_balance(marketplace_obj) == platform_accumulated + sum(seller_earnings)
    struct MarketplaceState has key {
        admin: address,
        platform_fee_bps: u64,
        /// APT octas accumulated as platform fees, not yet withdrawn.
        platform_accumulated: u64,
        /// Per-seller accumulated earnings in APT octas, not yet withdrawn.
        seller_earnings: Table<address, u64>,
        /// Total APT volume transacted through the marketplace (for analytics).
        total_volume: u64,
        extend_ref: ExtendRef,
    }

    /// Stored under each buyer's account. Tracks purchased datasets.
    struct PurchasedDatasets has key {
        /// dataset_id → unix timestamp of purchase
        items: Table<u64, u64>,
    }

    // ============ Init ============

    fun init_module(deployer: &signer) {
        let deployer_addr = signer::address_of(deployer);
        let constructor_ref = &object::create_named_object(deployer, MARKETPLACE_SEED);
        let obj_signer = object::generate_signer(constructor_ref);

        // Register APT coin store on the marketplace object so it can escrow funds.
        coin::register<AptosCoin>(&obj_signer);

        move_to(&obj_signer, MarketplaceState {
            admin: deployer_addr,
            platform_fee_bps: DEFAULT_PLATFORM_FEE_BPS,
            platform_accumulated: 0,
            seller_earnings: table::new(),
            total_volume: 0,
            extend_ref: object::generate_extend_ref(constructor_ref),
        });
    }

    // ============ Entry Functions ============

    /// Purchase a dataset. Transfers APT from buyer to escrow; records access on-chain.
    /// For free datasets (price_octas == 0), no APT is transferred but access is still recorded.
    public entry fun purchase_dataset(
        buyer: &signer,
        dataset_addr: address,
    ) acquires MarketplaceState, PurchasedDatasets {
        let buyer_addr = signer::address_of(buyer);
        let dataset_id = dataset_registry::get_id(dataset_addr);
        let seller_addr = dataset_registry::get_owner(dataset_addr);

        assert!(dataset_registry::is_active(dataset_addr), E_DATASET_NOT_ACTIVE);
        assert!(buyer_addr != seller_addr, E_SELF_PURCHASE);
        assert!(!has_access(buyer_addr, dataset_addr), E_ALREADY_PURCHASED);

        let price = dataset_registry::get_price(dataset_addr);
        let marketplace_obj_addr = get_marketplace_address();
        let state = borrow_global_mut<MarketplaceState>(marketplace_obj_addr);

        let platform_fee = 0u64;
        if (price > 0) {
            // Use u128 for intermediate multiplication to prevent overflow.
            // price_octas can approach u64::MAX; multiplying by fee_bps (max 1000)
            // would overflow u64 for prices above ~1.84e16 octas (≈184k APT).
            let fee_u128 = (price as u128) * (state.platform_fee_bps as u128) / 10000u128;
            platform_fee = (fee_u128 as u64);
            let seller_amount = price - platform_fee;

            // Transfer full payment into the marketplace escrow.
            coin::transfer<AptosCoin>(buyer, marketplace_obj_addr, price);

            // Accrue platform fee.
            state.platform_accumulated = state.platform_accumulated + platform_fee;

            // Accrue seller earnings (pull pattern — seller withdraws separately).
            if (table::contains(&state.seller_earnings, seller_addr)) {
                let existing = table::borrow_mut(&mut state.seller_earnings, seller_addr);
                *existing = *existing + seller_amount;
            } else {
                table::add(&mut state.seller_earnings, seller_addr, seller_amount);
            };

            state.total_volume = state.total_volume + price;
        };

        // Record purchase under the buyer's account.
        let now = timestamp::now_seconds();
        if (!exists<PurchasedDatasets>(buyer_addr)) {
            move_to(buyer, PurchasedDatasets { items: table::new() });
        };
        let purchased = borrow_global_mut<PurchasedDatasets>(buyer_addr);
        table::add(&mut purchased.items, dataset_id, now);

        // Notify the registry to increment the download counter.
        dataset_registry::increment_download_count(dataset_addr);

        event::emit(DatasetPurchased {
            buyer: buyer_addr,
            seller: seller_addr,
            dataset_addr,
            dataset_id,
            price_paid: price,
            platform_fee,
            purchased_at: now,
        });
    }

    /// Seller calls this to pull their accumulated earnings to their own wallet.
    public entry fun withdraw_earnings(seller: &signer) acquires MarketplaceState {
        let seller_addr = signer::address_of(seller);
        let state = borrow_global_mut<MarketplaceState>(get_marketplace_address());
        assert!(table::contains(&state.seller_earnings, seller_addr), E_NO_EARNINGS);
        let amount = *table::borrow(&state.seller_earnings, seller_addr);
        assert!(amount > 0, E_NO_EARNINGS);

        // Zero out earnings before transfer (checks-effects-interactions pattern).
        *table::borrow_mut(&mut state.seller_earnings, seller_addr) = 0;

        // Use the marketplace object's signer to authorize the transfer out.
        let marketplace_signer = object::generate_signer_for_extending(&state.extend_ref);
        coin::transfer<AptosCoin>(&marketplace_signer, seller_addr, amount);

        event::emit(EarningsWithdrawn {
            seller: seller_addr,
            amount,
            withdrawn_at: timestamp::now_seconds(),
        });
    }

    /// Admin-only: withdraw accumulated platform fees.
    public entry fun withdraw_platform_earnings(admin: &signer) acquires MarketplaceState {
        let admin_addr = signer::address_of(admin);
        let state = borrow_global_mut<MarketplaceState>(get_marketplace_address());
        assert!(admin_addr == state.admin, E_NOT_ADMIN);
        assert!(state.platform_accumulated > 0, E_NO_PLATFORM_EARNINGS);

        let amount = state.platform_accumulated;
        state.platform_accumulated = 0;

        let marketplace_signer = object::generate_signer_for_extending(&state.extend_ref);
        coin::transfer<AptosCoin>(&marketplace_signer, admin_addr, amount);

        event::emit(PlatformEarningsWithdrawn {
            admin: admin_addr,
            amount,
            withdrawn_at: timestamp::now_seconds(),
        });
    }

    /// Admin-only: update the platform fee. Max 10%.
    public entry fun set_platform_fee(admin: &signer, new_fee_bps: u64) acquires MarketplaceState {
        assert!(new_fee_bps <= MAX_PLATFORM_FEE_BPS, E_INVALID_FEE);
        let state = borrow_global_mut<MarketplaceState>(get_marketplace_address());
        assert!(signer::address_of(admin) == state.admin, E_NOT_ADMIN);
        let old_fee_bps = state.platform_fee_bps;
        state.platform_fee_bps = new_fee_bps;
        event::emit(PlatformFeeUpdated { old_fee_bps, new_fee_bps });
    }

    /// Admin-only: transfer admin rights to a new address.
    public entry fun transfer_admin(admin: &signer, new_admin: address) acquires MarketplaceState {
        assert!(new_admin != @0x0, E_ZERO_ADDRESS);
        let state = borrow_global_mut<MarketplaceState>(get_marketplace_address());
        assert!(signer::address_of(admin) == state.admin, E_NOT_ADMIN);
        state.admin = new_admin;
    }

    // ============ View Functions ============

    #[view]
    /// Returns the deterministic address of the MarketplaceState singleton object.
    public fun get_marketplace_address(): address {
        object::create_object_address(&@marketplace_addr, MARKETPLACE_SEED)
    }

    #[view]
    /// Returns true if `buyer_addr` has a purchase record for the given dataset.
    public fun has_access(buyer_addr: address, dataset_addr: address): bool acquires PurchasedDatasets {
        if (!exists<PurchasedDatasets>(buyer_addr)) {
            return false
        };
        let dataset_id = dataset_registry::get_id(dataset_addr);
        let purchased = borrow_global<PurchasedDatasets>(buyer_addr);
        table::contains(&purchased.items, dataset_id)
    }

    #[view]
    /// Unix timestamp of when `buyer_addr` purchased the dataset (aborts if not purchased).
    public fun get_purchase_time(
        buyer_addr: address,
        dataset_addr: address,
    ): u64 acquires PurchasedDatasets {
        let dataset_id = dataset_registry::get_id(dataset_addr);
        let purchased = borrow_global<PurchasedDatasets>(buyer_addr);
        *table::borrow(&purchased.items, dataset_id)
    }

    #[view]
    /// Pending earnings (APT octas) for a seller, not yet withdrawn.
    public fun get_seller_earnings(seller_addr: address): u64 acquires MarketplaceState {
        let state = borrow_global<MarketplaceState>(get_marketplace_address());
        if (table::contains(&state.seller_earnings, seller_addr)) {
            *table::borrow(&state.seller_earnings, seller_addr)
        } else {
            0
        }
    }

    #[view]
    public fun get_platform_fee_bps(): u64 acquires MarketplaceState {
        borrow_global<MarketplaceState>(get_marketplace_address()).platform_fee_bps
    }

    #[view]
    public fun get_platform_accumulated(): u64 acquires MarketplaceState {
        borrow_global<MarketplaceState>(get_marketplace_address()).platform_accumulated
    }

    #[view]
    public fun get_total_volume(): u64 acquires MarketplaceState {
        borrow_global<MarketplaceState>(get_marketplace_address()).total_volume
    }

    #[view]
    public fun get_admin(): address acquires MarketplaceState {
        borrow_global<MarketplaceState>(get_marketplace_address()).admin
    }

    // ============ Test Helpers ============

    #[test_only]
    public fun init_module_for_test(deployer: &signer) {
        init_module(deployer);
    }
}
