/// Dataset Registry — stores AI dataset metadata on-chain as Aptos Objects.
///
/// Each dataset is an Object owned by the Registry singleton. The logical
/// seller is tracked via the `owner` field inside DatasetInfo.
/// The Registry is a named singleton created at module init time.
module marketplace_addr::dataset_registry {
    use std::signer;
    use std::string::{Self, String};
    use std::vector;
    use aptos_framework::event;
    use aptos_framework::object::{Self, ExtendRef, DeleteRef};
    use aptos_framework::table::{Self, Table};
    use aptos_framework::timestamp;

    // ============ Error Codes ============

    const E_NOT_OWNER: u64 = 1;
    const E_EMPTY_STRING: u64 = 2;
    const E_STRING_TOO_LONG: u64 = 3;
    const E_ZERO_BYTES: u64 = 4;
    const E_INVALID_COMMITMENT: u64 = 5;
    const E_DATASET_NOT_FOUND: u64 = 6;
    const E_TOO_MANY_TAGS: u64 = 7;
    const E_TAG_TOO_LONG: u64 = 8;
    const E_PRICE_TOO_HIGH: u64 = 9;

    // ============ Constants ============

    const MAX_NAME_LENGTH: u64 = 100;
    const MAX_DESC_LENGTH: u64 = 1000;
    const MAX_BLOB_NAME_LENGTH: u64 = 200;
    const MAX_LICENSE_LENGTH: u64 = 50;
    const MAX_TAG_LENGTH: u64 = 50;
    const MAX_TAGS: u64 = 20;
    /// Shelby blob commitment is a cryptographic hash; 1–64 bytes covers all known formats.
    const MIN_COMMITMENT_LENGTH: u64 = 1;
    const MAX_COMMITMENT_LENGTH: u64 = 64;
    /// Max price: 1,000,000 APT in octas. Prevents u128→u64 truncation in fee math.
    const MAX_PRICE_OCTAS: u64 = 100_000_000_000_000; // 1,000,000 APT

    const REGISTRY_SEED: vector<u8> = b"dataset_registry_v1";

    // ============ Events ============

    #[event]
    struct DatasetRegistered has drop, store {
        dataset_id: u64,
        dataset_addr: address,
        owner: address,
        name: String,
        price_octas: u64,
        shelby_blob_name: String,
    }

    #[event]
    struct DatasetPriceUpdated has drop, store {
        dataset_id: u64,
        dataset_addr: address,
        old_price: u64,
        new_price: u64,
    }

    #[event]
    struct DatasetDeactivated has drop, store {
        dataset_id: u64,
        dataset_addr: address,
        owner: address,
    }

    #[event]
    struct DatasetReactivated has drop, store {
        dataset_id: u64,
        dataset_addr: address,
        owner: address,
    }

    // ============ Structs ============

    /// Per-dataset metadata stored as a Move resource at the dataset Object's address.
    /// The Object is owned by the Registry; `owner` tracks the logical seller.
    struct DatasetInfo has key {
        id: u64,
        owner: address,
        name: String,
        description: String,
        /// Canonical Shelby blob path: "<account>/<dataset-path>"
        shelby_blob_name: String,
        /// Cryptographic blob commitment produced by the Shelby SDK on upload.
        shelby_commitment: vector<u8>,
        size_bytes: u64,
        /// Price in APT octas. 0 = free dataset.
        price_octas: u64,
        tags: vector<String>,
        created_at: u64,
        license: String,
        download_count: u64,
        is_active: bool,
        extend_ref: ExtendRef,
        delete_ref: DeleteRef,
    }

    /// Singleton registry tracking all dataset objects by id.
    struct Registry has key {
        /// Maps dataset_id → Object address of DatasetInfo.
        datasets: Table<u64, address>,
        next_id: u64,
        extend_ref: ExtendRef,
    }

    // ============ Init ============

    fun init_module(deployer: &signer) {
        let constructor_ref = &object::create_named_object(deployer, REGISTRY_SEED);
        move_to(
            &object::generate_signer(constructor_ref),
            Registry {
                datasets: table::new(),
                next_id: 0,
                extend_ref: object::generate_extend_ref(constructor_ref),
            },
        );
    }

    // ============ Entry Functions ============

    /// Register a new dataset after uploading it to Shelby.
    /// `shelby_commitment` is the cryptographic blob commitment from the Shelby SDK.
    public entry fun register_dataset(
        owner: &signer,
        name: String,
        description: String,
        shelby_blob_name: String,
        shelby_commitment: vector<u8>,
        size_bytes: u64,
        price_octas: u64,
        tags: vector<String>,
        license: String,
    ) acquires Registry {
        // Validate strings
        assert!(string::length(&name) > 0, E_EMPTY_STRING);
        assert!(string::length(&name) <= MAX_NAME_LENGTH, E_STRING_TOO_LONG);
        assert!(string::length(&description) > 0, E_EMPTY_STRING);
        assert!(string::length(&description) <= MAX_DESC_LENGTH, E_STRING_TOO_LONG);
        assert!(string::length(&shelby_blob_name) > 0, E_EMPTY_STRING);
        assert!(string::length(&shelby_blob_name) <= MAX_BLOB_NAME_LENGTH, E_STRING_TOO_LONG);
        assert!(string::length(&license) > 0, E_EMPTY_STRING);
        assert!(string::length(&license) <= MAX_LICENSE_LENGTH, E_STRING_TOO_LONG);

        // Validate commitment
        let commitment_len = (vector::length(&shelby_commitment) as u64);
        assert!(commitment_len >= MIN_COMMITMENT_LENGTH, E_INVALID_COMMITMENT);
        assert!(commitment_len <= MAX_COMMITMENT_LENGTH, E_INVALID_COMMITMENT);

        // Validate price
        assert!(price_octas <= MAX_PRICE_OCTAS, E_PRICE_TOO_HIGH);

        // Validate size
        assert!(size_bytes > 0, E_ZERO_BYTES);

        // Validate tags
        let num_tags = (vector::length(&tags) as u64);
        assert!(num_tags <= MAX_TAGS, E_TOO_MANY_TAGS);
        vector::for_each_ref(&tags, |tag| {
            let tag: &String = tag;
            assert!(string::length(tag) > 0, E_EMPTY_STRING);
            assert!(string::length(tag) <= MAX_TAG_LENGTH, E_TAG_TOO_LONG);
        });

        let owner_addr = signer::address_of(owner);
        let registry_addr = get_registry_address();
        let registry = borrow_global_mut<Registry>(registry_addr);
        let dataset_id = registry.next_id;
        registry.next_id = dataset_id + 1;

        // Create dataset Object owned by the Registry
        let constructor_ref = &object::create_object(registry_addr);
        let obj_signer = object::generate_signer(constructor_ref);
        let dataset_addr = signer::address_of(&obj_signer);

        // Save copies for the event before moving values into the struct
        let event_name = copy name;
        let event_blob_name = copy shelby_blob_name;

        move_to(&obj_signer, DatasetInfo {
            id: dataset_id,
            owner: owner_addr,
            name,
            description,
            shelby_blob_name,
            shelby_commitment,
            size_bytes,
            price_octas,
            tags,
            created_at: timestamp::now_seconds(),
            license,
            download_count: 0,
            is_active: true,
            extend_ref: object::generate_extend_ref(constructor_ref),
            delete_ref: object::generate_delete_ref(constructor_ref),
        });

        table::add(&mut registry.datasets, dataset_id, dataset_addr);

        event::emit(DatasetRegistered {
            dataset_id,
            dataset_addr,
            owner: owner_addr,
            name: event_name,
            price_octas,
            shelby_blob_name: event_blob_name,
        });
    }

    /// Update the listing price. Only the dataset owner may call this.
    public entry fun update_price(
        owner: &signer,
        dataset_addr: address,
        new_price_octas: u64,
    ) acquires DatasetInfo {
        assert!(new_price_octas <= MAX_PRICE_OCTAS, E_PRICE_TOO_HIGH);
        let info = borrow_global_mut<DatasetInfo>(dataset_addr);
        assert!(info.owner == signer::address_of(owner), E_NOT_OWNER);
        let old_price = info.price_octas;
        info.price_octas = new_price_octas;
        event::emit(DatasetPriceUpdated {
            dataset_id: info.id,
            dataset_addr,
            old_price,
            new_price: new_price_octas,
        });
    }

    /// Update the description. Only the dataset owner may call this.
    public entry fun update_description(
        owner: &signer,
        dataset_addr: address,
        new_description: String,
    ) acquires DatasetInfo {
        assert!(string::length(&new_description) > 0, E_EMPTY_STRING);
        assert!(string::length(&new_description) <= MAX_DESC_LENGTH, E_STRING_TOO_LONG);
        let info = borrow_global_mut<DatasetInfo>(dataset_addr);
        assert!(info.owner == signer::address_of(owner), E_NOT_OWNER);
        info.description = new_description;
    }

    /// Soft-delete: mark dataset inactive. Existing buyers retain their access receipts.
    public entry fun deactivate_dataset(
        owner: &signer,
        dataset_addr: address,
    ) acquires DatasetInfo {
        let info = borrow_global_mut<DatasetInfo>(dataset_addr);
        assert!(info.owner == signer::address_of(owner), E_NOT_OWNER);
        info.is_active = false;
        event::emit(DatasetDeactivated {
            dataset_id: info.id,
            dataset_addr,
            owner: info.owner,
        });
    }

    /// Re-enable a previously deactivated dataset.
    public entry fun reactivate_dataset(
        owner: &signer,
        dataset_addr: address,
    ) acquires DatasetInfo {
        let info = borrow_global_mut<DatasetInfo>(dataset_addr);
        assert!(info.owner == signer::address_of(owner), E_NOT_OWNER);
        info.is_active = true;
        event::emit(DatasetReactivated {
            dataset_id: info.id,
            dataset_addr,
            owner: info.owner,
        });
    }

    // ============ Package-internal Functions ============

    /// Called by the Marketplace module after a purchase is confirmed.
    public(package) fun increment_download_count(dataset_addr: address) acquires DatasetInfo {
        let info = borrow_global_mut<DatasetInfo>(dataset_addr);
        info.download_count = info.download_count + 1;
    }

    // ============ View Functions ============

    #[view]
    /// Returns the deterministic address of the Registry singleton object.
    public fun get_registry_address(): address {
        object::create_object_address(&@marketplace_addr, REGISTRY_SEED)
    }

    #[view]
    /// Total number of datasets ever registered (including inactive ones).
    public fun get_dataset_count(): u64 acquires Registry {
        borrow_global<Registry>(get_registry_address()).next_id
    }

    #[view]
    /// Resolve a dataset_id to its Object address.
    public fun get_dataset_address(dataset_id: u64): address acquires Registry {
        let registry = borrow_global<Registry>(get_registry_address());
        assert!(table::contains(&registry.datasets, dataset_id), E_DATASET_NOT_FOUND);
        *table::borrow(&registry.datasets, dataset_id)
    }

    #[view]
    public fun is_active(dataset_addr: address): bool acquires DatasetInfo {
        borrow_global<DatasetInfo>(dataset_addr).is_active
    }

    #[view]
    public fun get_price(dataset_addr: address): u64 acquires DatasetInfo {
        borrow_global<DatasetInfo>(dataset_addr).price_octas
    }

    #[view]
    public fun get_owner(dataset_addr: address): address acquires DatasetInfo {
        borrow_global<DatasetInfo>(dataset_addr).owner
    }

    #[view]
    public fun get_id(dataset_addr: address): u64 acquires DatasetInfo {
        borrow_global<DatasetInfo>(dataset_addr).id
    }

    #[view]
    public fun get_blob_name(dataset_addr: address): String acquires DatasetInfo {
        borrow_global<DatasetInfo>(dataset_addr).shelby_blob_name
    }

    #[view]
    public fun get_description(dataset_addr: address): String acquires DatasetInfo {
        borrow_global<DatasetInfo>(dataset_addr).description
    }

    #[view]
    public fun get_commitment(dataset_addr: address): vector<u8> acquires DatasetInfo {
        borrow_global<DatasetInfo>(dataset_addr).shelby_commitment
    }

    #[view]
    public fun get_download_count(dataset_addr: address): u64 acquires DatasetInfo {
        borrow_global<DatasetInfo>(dataset_addr).download_count
    }

    #[view]
    /// Returns a tuple of the most commonly-needed dataset fields.
    /// (id, owner, name, description, size_bytes, price_octas, download_count, is_active)
    public fun get_dataset_info(
        dataset_addr: address,
    ): (u64, address, String, String, u64, u64, u64, bool) acquires DatasetInfo {
        let info = borrow_global<DatasetInfo>(dataset_addr);
        (
            info.id,
            info.owner,
            info.name,
            info.description,
            info.size_bytes,
            info.price_octas,
            info.download_count,
            info.is_active,
        )
    }

    // ============ Test Helpers ============

    #[test_only]
    public fun init_module_for_test(deployer: &signer) {
        init_module(deployer);
    }
}
