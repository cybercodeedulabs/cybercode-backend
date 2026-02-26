// backend/src/cloud/services/compute/manager.js

import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

// ================= CONFIG =================
const C3_HOST = "192.168.227.130";
const C3_USER = "c3cloud";
const SSH_TIMEOUT = 180000; // 30 sec safety timeout

// ================= IMAGE WHITELIST =================

const IMAGE_MAP = {
  "ubuntu-22.04": "ubuntu-22.04",
  "ubuntu-20.04": "ubuntu-20.04",

  // Custom Lab Images (will be created on C3 host)
  "python-lab": "c3-python-lab",
  "golang-lab": "c3-golang-lab",
  "devops-lab": "c3-devops-lab",
  "docker-lab": "c3-docker-lab",
  "security-lab": "c3-security-lab",
};

// ================= HELPERS =================

function buildSSHCommand(cmd) {
  return `ssh -n -o BatchMode=yes -o StrictHostKeyChecking=no ${C3_USER}@${C3_HOST} "${cmd}"`;
}

function sanitizeContainerName(str = "") {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
    .slice(0, 40);
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

function normalizeImage(image) {
  const normalized = IMAGE_MAP[image];
  if (!normalized) {
    throw new Error(`Unsupported image: ${image}`);
  }
  return normalized;
}

// ================= CORE FUNCTIONS =================

export async function provisionInstanceOnHost(opts = {}) {
  const {
    ownerEmail = "unknown",
    organizationId,
    customName,
    image = "ubuntu:22.04",
    cpu = 1,
    ram = 1,
    disk = 2,
  } = opts;

  const name = generateInstanceName(ownerEmail, customName);
  const normalizedImage = normalizeImage(image);

// ================= ORG NETWORK ISOLATION =================

if (!organizationId) {
  throw new Error("Missing organizationId for network isolation");
}

const shortOrgId = organizationId.slice(0, 8);
const networkName = `c3-org-${shortOrgId}`;
const profileName = `c3-org-${shortOrgId}`;

// Check network existence
const networkCheckCmd = `lxc network show ${networkName}`;
try {
  await execAsync(buildSSHCommand(networkCheckCmd), { timeout: SSH_TIMEOUT });
} catch {
  const subnetBase = Math.floor(Math.random() * 200) + 10;
  const createNetworkCmd = `
    lxc network create ${networkName} \
    ipv4.address=10.${subnetBase}.1.1/24 \
    ipv4.nat=true \
    ipv6.address=none
  `;
  await execAsync(buildSSHCommand(createNetworkCmd), {
    timeout: SSH_TIMEOUT,
  });
}

// Check profile existence
const profileCheckCmd = `lxc profile show ${profileName}`;
try {
  await execAsync(buildSSHCommand(profileCheckCmd), { timeout: SSH_TIMEOUT });
} catch {
  await execAsync(buildSSHCommand(`lxc profile create ${profileName}`), {
    timeout: SSH_TIMEOUT,
  });

  await execAsync(
    buildSSHCommand(
      `lxc profile device add ${profileName} eth0 nic network=${networkName}`
    ),
    { timeout: SSH_TIMEOUT }
  );
}

//  const launchCmd = `lxc launch ${normalizedImage} ${name} --quiet`;
const launchCmd = `
lxc launch ${normalizedImage} ${name} \
--profile c3-restricted \
--profile ${profileName} \
--quiet \
-c limits.cpu=${cpu} \
-c limits.memory=${ram}GB \
-c limits.memory.swap=false \
-d root,size=${disk}GB
`;


  try {
    console.log("Launching:", name);

    await execAsync(buildSSHCommand(launchCmd), {
      timeout: SSH_TIMEOUT,
    });

    return {
      name,
      image: normalizedImage,
      cpu,
      ram,
      disk,
      status: "RUNNING",
      owner: ownerEmail,
    };

  } catch (err) {
    console.error("Provision error:", err?.stderr || err);
    throw new Error("Failed to provision container on C3 host");
  }
}

export async function terminateInstanceOnHost(containerName) {
  if (!containerName) {
    throw new Error("Missing container name");
  }

  const safeName = sanitizeContainerName(containerName);

  try {
    // 🔎 First check if container exists
    const checkCmd = `lxc info ${safeName}`;
    await execAsync(buildSSHCommand(checkCmd), {
      timeout: SSH_TIMEOUT,
    });

  } catch (err) {
    console.error("Container not found on host:", safeName);
    throw new Error("Container does not exist on host");
  }

  try {
    const deleteCmd = `lxc delete ${safeName} --force --quiet`;

    await execAsync(buildSSHCommand(deleteCmd), {
      timeout: SSH_TIMEOUT,
    });

    console.log("Deleted container:", safeName);

    return { success: true };

  } catch (err) {
    console.error("Terminate error:", err?.stderr || err);
    throw new Error("Failed to terminate container on host");
  }
}

export async function getHostUsageSummary() {
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