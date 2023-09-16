import * as config from "./config.js"
import * as p2pClient from "./Libp2pClient.js";
import chalk from "chalk";
import axios from "axios";


let nodeResponseLoaded = false;
let nodesResponse = [];
export let deployerNodes = [];


export async function loadNodes() {
  if (config.NETWORK == "local")
    return loadLocalNodes();
  if (nodeResponseLoaded)
    return "data loaded";
  return axios.get("https://monitor1.muon.net/nodes")
    .then(({data}) => {
      if (data.success) {
        nodeResponseLoaded = true;
        nodesResponse = data.result;
        deployerNodes = nodesResponse.filter(node => node.isDeployer);
      }
    })
    .catch((e) => {
      console.log("error checkActiveNodes: " + e.message);
      return false;
    });
}

async function loadLocalNodes() {
  return axios.get(`${config.DELEGATE}/onlines`)
    .then(async ({data}) => {
      nodeResponseLoaded = true;
      for (let i = 0; i < data.length; i++) {
        let node = data[i];
        let status = await axios.get(`http://localhost:${node.gatewayPort}/onlines`)
      }
    })
    .catch((e) => {
      console.log("error checkActiveNodes: " + e.message);
      return false;
    });
}

export async function loadAppContext(appId, targetIp, targetId) {
  console.log(`Query app context from ${targetIp || targetId}`);
  let context = await p2pClient.call({
    ip: targetIp,
    id: targetId,
    "method": "AppManager.get-app-context",
    "params": {appId: appId}
  })
    .then(result => {
      let resultContext = result.response[result.response.length - 1];
      console.log(chalk.green("context load successful"));
      return resultContext;
    })
    .catch(e => {
      console.log(chalk.red(`load context failed from: ${targetIp || targetId} : ${e | e.message}`));
      return null;
    });
  return context;
}

export async function loadAppContextExplorer(url, appId) {
  console.log(`Query app context from ${url}`);
  let context = await axios.get(`${url}/v1/?app=explorer&method=app&params[appId]=${appId}`)
    .then(({data}) => {
      if (!data.success)
        throw `data.success is false`;
      console.log(chalk.green("context load successful"));
      return data.result;
    })
    .catch(e => {
      console.log(chalk.red(`load context failed from: ${url} : ${e | e.message}`));
      return null;
    });
  return context;
}

export async function getAppStatus(appName) {
  return axios.get(`${config.GATEWAY_URL}/v1/?app=explorer&method=app&params[appName]=${appName}`)
    .then(({data}) => {
      return data.result;
    })
    .catch(e => {
      throw "get app status request failed: " + e.message
    });
}

export function getRandomDeployerIp() {
  // return "18.221.53.56";
  let index = Math.floor(Math.random() * deployerNodes.length);
  return deployerNodes[index].ip;
}