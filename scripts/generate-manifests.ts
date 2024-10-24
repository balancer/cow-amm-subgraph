import yaml = require("js-yaml");

import Handlebars = require("handlebars");
import fs = require("fs-extra");
import path = require("path");

const generateManifests = async (): Promise<void> => {
  const networksFilePath = path.resolve(__dirname, "../networks.yaml");
  const networks: any = yaml.load(
    await fs.readFile(networksFilePath, { encoding: "utf-8" })
  );

  const template = fs.readFileSync("manifest.template.yaml").toString();
  Object.entries(networks).forEach(([network, config]) => {
    fs.writeFileSync(
      `subgraph${network === "mainnet" ? "" : `.${network}`}.yaml`,
      Handlebars.compile(template)(config)
    );
  });

  // eslint-disable-next-line no-console
  console.log("🎉 subgraph successfully generated\n");
};

generateManifests();
