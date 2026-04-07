/**
 * B15-6: Dry-Run Saga Integration Test
 *
 * Tests the full pair provisioning flow using DryRunProvider + DryRunRegistrar.
 * Verifies:
 * - DryRunProvider/DryRunRegistrar implement interfaces correctly
 * - All operations execute without throwing
 * - testConnection() works
 * - createServer() returns valid ServerInfo
 * - setPTR() completes
 * - DNS operations (setNameservers, setGlueRecords, createRecord, deleteRecord) work
 * - Provider registry getDryRunProviders() returns both providers
 *
 * NOTE: This test does NOT run the full SagaEngine (which requires Supabase),
 * but validates all the provider operations that the saga calls.
 */

import { DryRunProvider, DryRunRegistrar } from "../providers/dry-run";
import { getDryRunProviders } from "../provider-registry";
import type { ServerCreateParams, PTRParams, DNSRecordParams } from "../types";

// ============================================
// DryRunProvider Tests
// ============================================

async function testDryRunProvider(): Promise<void> {
  const logs: string[] = [];
  const provider = new DryRunProvider((msg) => logs.push(msg));

  console.log("\n=== DryRunProvider Tests ===\n");

  // Test 1: testConnection
  const conn = await provider.testConnection();
  assert(conn.ok === true, "testConnection should return ok:true");
  assert(typeof conn.message === "string", "testConnection should return message");
  console.log("✓ testConnection()");

  // Test 2: listImages
  const images = await provider.listImages();
  assert(images.length > 0, "listImages should return at least one image");
  assert(images[0].id !== undefined, "Image should have id");
  assert(images[0].name !== undefined, "Image should have name");
  console.log(`✓ listImages() — ${images.length} images`);

  // Test 3: listRegions
  const regions = await provider.listRegions();
  assert(regions.length > 0, "listRegions should return at least one region");
  assert(regions[0].id !== undefined, "Region should have id");
  assert(regions[0].name !== undefined, "Region should have name");
  console.log(`✓ listRegions() — ${regions.length} regions`);

  // Test 4: createServer
  const params: ServerCreateParams = {
    name: "mail1.testdomain.com",
    region: "us-east-1",
    size: "small",
  };
  const server = await provider.createServer(params);
  assert(server.id !== undefined, "Server should have id");
  assert(server.ip !== undefined, "Server should have ip");
  assert(server.status === "active", "Server should be active");
  assert(server.name === params.name, "Server name should match");
  console.log(`✓ createServer() — id=${server.id}, ip=${server.ip}`);

  // Test 5: getServer
  const fetched = await provider.getServer(server.id);
  assert(fetched.id === server.id, "Fetched server should match created");
  assert(fetched.ip === server.ip, "Fetched IP should match");
  console.log(`✓ getServer()`);

  // Test 6: setPTR
  const ptrParams: PTRParams = { ip: server.ip, hostname: "mail1.testdomain.com" };
  await provider.setPTR(ptrParams);
  console.log("✓ setPTR()");

  // Test 7: deleteServer
  await provider.deleteServer(server.id);
  console.log("✓ deleteServer()");

  // Test 8: Logs captured
  assert(logs.length > 0, "Should have captured log messages");
  console.log(`✓ Logging — ${logs.length} messages captured`);

  console.log("\n=== DryRunProvider: ALL PASSED ===\n");
}

// ============================================
// DryRunRegistrar Tests
// ============================================

async function testDryRunRegistrar(): Promise<void> {
  const logs: string[] = [];
  const registrar = new DryRunRegistrar((msg) => logs.push(msg));

  console.log("\n=== DryRunRegistrar Tests ===\n");

  // Test 1: testConnection
  const conn = await registrar.testConnection();
  assert(conn.ok === true, "testConnection should return ok:true");
  console.log("✓ testConnection()");

  // Test 2: setNameservers
  await registrar.setNameservers("testdomain.com", [
    "ns1.testdomain.com",
    "ns2.testdomain.com",
  ]);
  console.log("✓ setNameservers()");

  // Test 3: setGlueRecords
  await registrar.setGlueRecords("testdomain.com", [
    { hostname: "ns1.testdomain.com", ip: "10.0.0.1" },
    { hostname: "ns2.testdomain.com", ip: "10.0.0.2" },
  ]);
  console.log("✓ setGlueRecords()");

  // Test 4: createZone
  await registrar.createZone("testdomain.com");
  console.log("✓ createZone()");

  // Test 5: createRecord
  const recordParams: DNSRecordParams = {
    zone: "testdomain.com",
    type: "A",
    name: "mail1",
    value: "10.0.0.1",
    ttl: 3600,
  };
  const record = await registrar.createRecord(recordParams);
  assert(record.id !== undefined, "Record should have id");
  console.log(`✓ createRecord() — id=${record.id}`);

  // Test 6: createRecord with MX
  const mxRecord = await registrar.createRecord({
    zone: "testdomain.com",
    type: "MX",
    name: "@",
    value: "mail1.testdomain.com",
    priority: 10,
  });
  assert(mxRecord.id !== undefined, "MX record should have id");
  console.log(`✓ createRecord(MX) — id=${mxRecord.id}`);

  // Test 7: deleteRecord
  await registrar.deleteRecord("testdomain.com", record.id);
  console.log("✓ deleteRecord()");

  // Test 8: Logs captured
  assert(logs.length > 0, "Should have captured log messages");
  console.log(`✓ Logging — ${logs.length} messages captured`);

  console.log("\n=== DryRunRegistrar: ALL PASSED ===\n");
}

// ============================================
// Provider Registry Tests
// ============================================

async function testProviderRegistry(): Promise<void> {
  console.log("\n=== Provider Registry Tests ===\n");

  const { vps, dns } = await getDryRunProviders();

  const vpsConn = await vps.testConnection();
  assert(vpsConn.ok === true, "VPS dry-run should connect");
  console.log("✓ getDryRunProviders().vps.testConnection()");

  const dnsConn = await dns.testConnection();
  assert(dnsConn.ok === true, "DNS dry-run should connect");
  console.log("✓ getDryRunProviders().dns.testConnection()");

  // Test full pair creation flow (simulated)
  const server1 = await vps.createServer({
    name: "mail1.testns.com",
    region: "us-east-1",
    size: "small",
  });
  const server2 = await vps.createServer({
    name: "mail2.testns.com",
    region: "us-east-1",
    size: "small",
  });

  await vps.setPTR({ ip: server1.ip, hostname: "mail1.testns.com" });
  await vps.setPTR({ ip: server2.ip, hostname: "mail2.testns.com" });

  await dns.setNameservers("testns.com", [
    "ns1.testns.com",
    "ns2.testns.com",
  ]);
  await dns.setGlueRecords("testns.com", [
    { hostname: "ns1.testns.com", ip: server1.ip },
    { hostname: "ns2.testns.com", ip: server2.ip },
  ]);

  await dns.createRecord({
    zone: "testns.com",
    type: "A",
    name: "mail1",
    value: server1.ip,
  });
  await dns.createRecord({
    zone: "testns.com",
    type: "A",
    name: "mail2",
    value: server2.ip,
  });

  // Rollback
  await vps.deleteServer(server1.id);
  await vps.deleteServer(server2.id);

  console.log("✓ Full dry-run pair creation + rollback flow");
  console.log("\n=== Provider Registry: ALL PASSED ===\n");
}

// ============================================
// Utilities
// ============================================

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

// ============================================
// Main
// ============================================

async function main(): Promise<void> {
  console.log("B15-6 Dry-Run Saga Integration Test");
  console.log("====================================\n");

  try {
    await testDryRunProvider();
    await testDryRunRegistrar();
    await testProviderRegistry();

    console.log("\n====================================");
    console.log("ALL TESTS PASSED ✓");
    console.log("====================================\n");
    process.exit(0);
  } catch (err) {
    console.error("\n====================================");
    console.error("TEST FAILED:", err instanceof Error ? err.message : err);
    console.error("====================================\n");
    process.exit(1);
  }
}

main();
