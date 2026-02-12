// backend/src/cloud/services/compute/manager.js

import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

// ================= CONFIG =================
const C3_HOST = "192.168.227.130";
const C3_USER = "c3cloud";
const SSH_TIMEOUT = 30000; // 30 sec safety timeout

// ================= HELPERS =================

function buildSSHCommand(cmd) {
  return `ssh -n -o BatchMode=yes -o StrictHostKeyChecking=no ${C3_USER}@${C3_HOST} "${cmd}"`;
}

function sanitizeContainerName(str = "") {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")  // allow only a-z 0-9 -
    .replace(/^-+/, "")         // remove leading -
    .replace(/-+$/, "")         // remove trailing -
    .slice(0, 40);              // safe length
}

function generateInstanceName(ownerEmail, customName) {
  const base = customName
    ? sanitizeContainerName(customName)
    : sanitizeContainerName(ownerEmail.split("@")[0] || "user");

  if (!base) {
    throw new Error("Invalid container name");
  }

  const suffix = Date.now().toString().slice(-6);
  return `c3-${base}-${suffix}`;
}

// ================= CORE FUNCTIONS =================

export async function provisionInstanceOnHost(opts = {}) {
  const {
    ownerEmail = "unknown",
    customName,
    image = "ubuntu:22.04",
    cpu = 1,
    ram = 1,
    disk = 2,
  } = opts;

  const name = generateInstanceName(ownerEmail, customName);

  // --quiet avoids interactive output
  const launchCmd = `lxc launch ${image} ${name} --quiet`;

  try {
    console.log("Launching:", name);

    const { stdout, stderr } = await execAsync(
      buildSSHCommand(launchCmd),
      { timeout: SSH_TIMEOUT }
    );

    if (stderr) {
      console.warn("LXC stderr:", stderr);
    }

    return {
      id: name,
      name,
      image,
      cpu,
      ram,
      disk,
      status: "RUNNING",
      freeTier: false,
      owner: ownerEmail,
    };

  } catch (err) {
    console.error("Provision error:", err);
    throw new Error("Failed to provision container on C3 host");
  }
}

export async function terminateInstanceOnHost(instanceMeta) {
  if (!instanceMeta?.id) {
    throw new Error("Missing instance id");
  }

  const deleteCmd = `lxc delete ${instanceMeta.id} --force --quiet`;

  try {
    await execAsync(buildSSHCommand(deleteCmd), {
      timeout: SSH_TIMEOUT,
    });

    return { success: true };

  } catch (err) {
    console.error("Terminate error:", err);
    throw new Error("Failed to terminate container");
  }
}

export async function getHostUsageSummary() {
  // For now static — later we will calculate via:
  // lxc list + lxc info + disk usage

  return {
    cpuUsed: 0,
    cpuQuota: 64,
    storageUsed: 0,
    storageQuota: 1024,
    activeUsers: 0,
  };
}

export default {
  provisionInstanceOnHost,
  terminateInstanceOnHost,
  getHostUsageSummary,
};
