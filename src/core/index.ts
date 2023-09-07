import Muon, { MuonPlugin, MuonPluginConfigs } from "./muon.js";
import mongoose from "mongoose"
import path from "path"
import fs from "fs"
import { dynamicExtend } from "./utils.js"
import { fileCID } from "../utils/cid.js"
import BaseApp from "./plugins/base/base-app-plugin.js";
import "./global.js"
import loadConfigs from "../network/configurations.js"
import Web3 from 'web3'
import chalk from "chalk"
import { Constructor } from "../common/types";
import BasePlugin from "./plugins/base/base-plugin.js";
import {logger} from '@libp2p/logger'
import { createRequire } from "module";
import {filePathInfo} from "../utils/helpers.js";

const {__dirname} = filePathInfo(import.meta)
const {utils: { sha3 }} = Web3
const log = logger("muon:core");

const muonAppRequire = createRequire(import.meta.url);
// override .js loader
muonAppRequire.extensions[".js"] = function(module, filename) {
  const content = fs.readFileSync(filename, "utf8");
  // @ts-ignore
  module._compile(content, filename);
};

async function getEnvPlugins(): Promise<MuonPlugin[]> {
  let pluginsStr = process.env["MUON_PLUGINS"];
  if (!pluginsStr) return [];
  let result: MuonPlugin[] = [];
  for (let key of pluginsStr.split("|")) {
    result.push({
      name: `__${key}__`,
      module: (await import(`./plugins/${key}`)).default,
      config: {},
    });
  }
  return result;
}

function prepareApp(app, fileName, isBuiltInApp = false, filePath = "")
  : [Constructor<BasePlugin>, MuonPluginConfigs] {
  if (!app.APP_ID) {
    app.APP_ID = sha3(fileName);
  }

  app.APP_ID = BigInt(app.APP_ID).toString(10);
  app.isBuiltInApp = isBuiltInApp;
  if (filePath) {
    app.APP_CID = fileCID(filePath);
  }
  return [dynamicExtend(BaseApp, app), {}];
}

function loadApp(path) {
  try {
    muonAppRequire.resolve(path);
    return muonAppRequire(path);
  } catch (e) {
    console.error(chalk.red(`Error when loading app from path [${path}]`));
    console.error(e);
    return undefined;
  }
}

function getCustomApps(): MuonPlugin[] {
  let pluginsStr = process.env["MUON_CUSTOM_APPS"];
  if (!pluginsStr) return [];
  let result: MuonPlugin[] = [];
  pluginsStr.split("|").forEach((name) => {
    let appPath = `../../apps/custom/${name}`;
    let app = loadApp(appPath);
    if (app && !!app.APP_NAME) {
      const [module, config] = prepareApp(
        app,
        `${name}.js`,
        false,
        path.join(__dirname, `${appPath}.js`)
      );
      result.push({ name, module, config });
    }
  });
  return result;
}

function getBuiltInApps(): MuonPlugin[] {
  const appDir = path.join(__dirname, "../built-in-apps");
  let result: MuonPlugin[] = [];
  let files = fs.readdirSync(appDir);
  for(let i=0 ; i<files.length ; i++) {
    const file = files[i]
    let ext = file.split(".").pop();
    if (ext && ext.toLowerCase() === "js") {
      let app = loadApp(`../built-in-apps/${file}`);
      if (app && !!app.APP_NAME) {
        const [module, config] = prepareApp(app, file, true);
        result.push({ name: app.APP_NAME, module, config });
      }
    }
  };
  return result;
}

function getGeneralApps(): MuonPlugin[] {
  const appDir = path.join(__dirname, "../../apps/general");
  let result: MuonPlugin[] = [];
  let files = fs.readdirSync(appDir);
  files.forEach((file) => {
    let ext = file.split(".").pop();
    if (ext && ext.toLowerCase() === "js") {
      let appPath = `../../apps/general/${file}`;
      let app = loadApp(appPath);
      if (app && !!app.APP_NAME) {
        const [module, config] = prepareApp(app, file,
          false, path.join(__dirname, `${appPath}`));
        result.push({ name: app.APP_NAME, module, config });
      }
    }
  });
  return result;
}

var muon: Muon;

async function start() {
  log("starting ...");
  await mongoose.connect(process.env.MONGODB_CS!, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });

  if (!mongoose.connection) throw "Error connecting to MongoDB";

  log(`MongoDB successfully connected.`);

  let config = await loadConfigs();
  let { net } = config;
  try {
    // const nodeVersion = process.versions.node.split('.');
    // if(nodeVersion[0] < '16')
    //   throw {message: `Node version most be >="16.0.0". current version is "${process.versions.node}"`}
    muon = new Muon({
      plugins: [
        {
          name: "node-manager",
          module: (await import("./plugins/node-manager.js")).default,
          config: {},
        },
        {
          name: "app-manager",
          module: (await import("./plugins/app-manager.js")).default,
          config: {},
        },
        {
          name: "remote-call",
          module: (await import("./plugins/remote-call.js")).default,
          config: {},
        },
        {
          name: "gateway-interface",
          module: (await import("./plugins/gateway-Interface.js")).default,
          config: {},
        },
        {
          name: "ipc",
          module: (await import("./plugins/core-ipc-plugin.js")).default,
          config: {},
        },
        {
          name: "ipc-handlers",
          module: (await import("./plugins/core-ipc-handlers.js")).default,
          config: {},
        },
        {
          name: "broadcast",
          module: (await import("./plugins/broadcast.js")).default,
          config: {},
        },
        {
          name: "memory",
          module: (await import("./plugins/memory-plugin.js")).default,
          config: {},
        },
        {
          name: "key-manager",
          module: (await import("./plugins/key-manager.js")).default,
          config: {},
        },
        {
          name: "health-check",
          module: (await import("./plugins/health-check.js")).default,
          config: {},
        },
        {
          name: "explorer",
          module: (await import("./plugins/explorer.js")).default,
          config: {},
        },
        // {
        //   name: "dht",
        //   module: (await import("./plugins/dht.js")).default,
        //   config: {},
        // },
        {
          name: "system",
          module: (await import("./plugins/system.js")).default,
          config: {},
        },
        {
          name: "mpcnet",
          module: (await import("./plugins/mpc-network.js")).default,
          config: {},
        },
        {
          name: "db-synchronizer",
          module: (await import("./plugins/db-synchronizer.js")).default,
          config: {},
        },
        {
          name: "reshare-cj",
          module: (await import("./plugins/cron-jobs/reshare-cron-job.js")).default,
          config: {},
        },
        ...(await getEnvPlugins()),
        ...getCustomApps(),
        ...getGeneralApps(),
        ...getBuiltInApps(),
      ],
      net,
    });

    await muon.initialize();

    await muon.start();
  } catch (e) {
    console.error(e);
    throw e;
  }
}

export {
  start,
};
