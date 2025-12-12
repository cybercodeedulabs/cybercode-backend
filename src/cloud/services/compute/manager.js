// backend/src/cloud/services/compute/manager.js

/**
 * compute manager placeholder
 * Later this will contain logic to:
 *  - create overlays / qemu commands / openstack calls
 *  - map ports, allocate ssh ports
 *  - manage lifecycle
 *
 * For now keep simple functions returning "not implemented".
 */

export async function provisionInstanceOnHost(opts = {}) {
  // opts: { ownerEmail, image, cpu, ram, disk, plan, freeTier }
  throw new Error("provisionInstanceOnHost not implemented");
}

export async function terminateInstanceOnHost(instanceMeta) {
  throw new Error("terminateInstanceOnHost not implemented");
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
