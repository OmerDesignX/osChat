const packageJson = require("../package.json");

module.exports = {
  ...packageJson.build,
  linux: {
    ...packageJson.build.linux,
    target: ["snap"],
    extraResources: packageJson.build.linux.extraResources,
  },
};
