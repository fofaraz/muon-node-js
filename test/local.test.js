import axios from 'axios'
import * as appCMD from '../src/cmd/modules/cmd-app-mod.ts'
import * as utils from './utils.js'
import * as config from './config.js'
import chalk from 'chalk'
import assert from "assert"
import * as p2pClient from "./Libp2pClient.js"


const deployers = ["http://127.0.0.1:8000", "http://127.0.0.1:8001"];


describe('Deployment process', async function () {
  this.timeout(5 * 60000);
  before(async () => {
    await utils.loadNodes();
  });

  describe('Deployment scenario', function () {
    it("Before deploy, app should be undeployed and app status should be NEW", async () => {
      let appStatus = await utils.getAppStatus(config.APP_NAME);

      if (appStatus.status != "NEW")
        await undeploy(config.APP_NAME, appStatus.appId);
      appStatus = await utils.getAppStatus(config.APP_NAME);
      assert.equal(appStatus.status, "NEW");
    });
    it("After deployment request, app status should be DEPLOYED", async () => {
      await deploy(config.APP_NAME);
      let appStatus = await utils.getAppStatus(config.APP_NAME);
      assert.equal(appStatus.status, "DEPLOYED");
    });
    it('App context should be available and equal on all deployers', async () => {
      let compareResult = await checkContextOnAllDeployers();
      assert.equal(compareResult, true);
    });
    it('All deployer nodes should be able to execute and sign app requests', async () => {
      let failedNodes = await execRequestOnDeployers(config.APP_NAME);
      assert.equal(failedNodes, 0);
    });
  });

});


async function undeploy(appName, appId) {
  console.log(`Undeploying app: ${appName}`);
  let cmdConfig = config.DEPLOY_CONFIG;
  cmdConfig.deployers = deployers;
  for (let i = 0; i < cmdConfig.deployers.length; i++)
    cmdConfig.deployers[i] = cmdConfig.deployers[i] + "/v1";
  let undeployResp = await appCMD.undeployApp({app: appName}, cmdConfig);


  for (let i = 0; i < deployers.length; i++) {
    let context = await utils.loadAppFromExplorer(deployers[i], {appId});
    if (context.status != "NEW")
      throw "Undeploy failed: " + undeployResp.error;
  }

  console.log(chalk.green("Undeploy successful"));
}

async function deploy(appName) {
  console.log(`Deploying ${appName}`);
  await appCMD.deployApp({app: appName}, config.DEPLOY_CONFIG);
  console.log(`Deployment command finished.`);
  console.log(`Checking deployment status from explorer app`);
  let appStatus = await utils.getAppStatus(appName);

  if (appStatus.status == "DEPLOYED")
    console.log(chalk.green("App successfully deployed."));
  else {
    console.log(chalk.red(`App not deployed. status: ${appStatus.status}`));
    throw "deploy failed";
  }
}

async function execRequestOnDeployers(appName) {
  console.log("Sending sign request to deployers");
  let promises = [];
  deployers.forEach(deployer => {
    promises.push(new Promise(async (resolve, reject) => {
      let result = await axios.get(`${deployer}/v1/`, {
        params: {
          app: appName,
          method: "test"
        }
      })
        .catch(e => {
          throw `${deployer}: app exec failed ${e.message}`;
        });

      result=result.data;
      let resp = {deployer, result: false};
      if (result.success) {
        console.log(chalk.green(`${deployer}: Exec app request success`));
        resp.result = true;
      } else {
        console.log(chalk.red(`${deployer}: Exec app request failed. error: ${result?.error?.message}`));
      }

      resolve(resp);
    }))
  });
  let responses = await Promise.all(promises);
  let total = 0;
  let success = 0;
  let fail = 0;
  responses.forEach(response => {
    total++;
    if (response.result) {
      success++;
    } else {
      fail++;
    }
  });

  console.log(`Sign requests: Total:${total} Success:${success} Fail:${fail}`);
  return fail;
}

async function checkContextOnAllDeployers() {
  let appStatus = await utils.getAppStatus(config.APP_NAME);
  let appId = appStatus.appId;
  console.log("Checking context on all deployers");

  let promises = [];
  deployers.forEach(deployer => {
    promises.push(new Promise(async (resolve, reject) => {
      let appResp = await utils.loadAppFromExplorer(deployer, {appId})
        .catch(e => {
          reject(e);
        });
      resolve({deployer: deployer, appResp});
    }))
  });
  let responses = await Promise.all(promises);
  let deploymentReqId;

  let allEqual = true;
  responses.forEach(response => {
    let latestContext = utils.getLatestContext(response.appResp.contexts);
    let currentDeploymetReqId = latestContext.keyGenReqId;
    if (!deploymentReqId)
      deploymentReqId = currentDeploymetReqId;
    if (currentDeploymetReqId && deploymentReqId == currentDeploymetReqId)
      console.log(chalk.green(`${response.deployer}: context verified`));
    else {
      console.log(chalk.red(`${response.deployer}: context failed`));
      allEqual = false;
    }
  });

  return allEqual;
}

