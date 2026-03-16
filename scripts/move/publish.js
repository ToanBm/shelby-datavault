// Load from .env then .env.local so vars in either file are picked up.
require("dotenv").config();
require("dotenv").config({ path: ".env.local", override: true });

const fs = require("node:fs");
const cli = require("@aptos-labs/ts-sdk/dist/common/cli/index.js");

const STAGING_NODE = "https://api.testnet.staging.aptoslabs.com/v1";
const nodeUrl = process.env.NEXT_PUBLIC_APTOS_NODE_URL ?? STAGING_NODE;

const publisherAddress = process.env.NEXT_MODULE_PUBLISHER_ACCOUNT_ADDRESS;
const publisherKey     = process.env.NEXT_MODULE_PUBLISHER_ACCOUNT_PRIVATE_KEY;

if (!publisherAddress) {
  console.error("❌  NEXT_MODULE_PUBLISHER_ACCOUNT_ADDRESS is not set in .env.local");
  process.exit(1);
}
if (!publisherKey) {
  console.error("❌  NEXT_MODULE_PUBLISHER_ACCOUNT_PRIVATE_KEY is not set in .env.local");
  process.exit(1);
}

async function publish() {
  const move = new cli.Move();

  move
    .createObjectAndPublishPackage({
      packageDirectoryPath: "contract",
      addressName: "marketplace_addr",
      namedAddresses: {
        marketplace_addr: publisherAddress,
      },
      extraArguments: [
        `--private-key=${publisherKey}`,
        `--url=${nodeUrl}`,
        "--assume-yes",
      ],
    })
    .then((response) => {
      const filePath = ".env.local";
      let envContent = fs.existsSync(filePath)
        ? fs.readFileSync(filePath, "utf8")
        : "";

      const regex = /^NEXT_PUBLIC_MODULE_ADDRESS=.*$/m;
      const newEntry = `NEXT_PUBLIC_MODULE_ADDRESS=${response.objectAddress}`;

      if (envContent.match(regex)) {
        envContent = envContent.replace(regex, newEntry);
      } else {
        envContent += `\n${newEntry}\n`;
      }

      fs.writeFileSync(filePath, envContent, "utf8");
      console.log(`\n✅ Module deployed to object address: ${response.objectAddress}`);
      console.log(`   NEXT_PUBLIC_MODULE_ADDRESS written to .env.local`);
    });
}
publish();
