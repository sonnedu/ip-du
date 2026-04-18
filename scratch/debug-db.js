/**
 * Debug script to inspect the raw data returned by MMDB for a specific IP.
 */
import { Reader } from 'mmdb-lib';
import fs from 'fs';
import path from 'path';

const DATA_DIR = './data';
const CITY_V4_PATH = path.join(DATA_DIR, 'dbip-city-ipv4.mmdb');
const ASN_PATH = path.join(DATA_DIR, 'asn.mmdb');

async function debugLookup(ip) {
  if (fs.existsSync(CITY_V4_PATH)) {
    const cityReader = new Reader(fs.readFileSync(CITY_V4_PATH));
    const cityResult = cityReader.get(ip);
    console.log('\n--- Raw City Record ---');
    console.log(JSON.stringify(cityResult, null, 2));
  } else {
    console.log('City DB missing');
  }

  if (fs.existsSync(ASN_PATH)) {
    const asnReader = new Reader(fs.readFileSync(ASN_PATH));
    const asnResult = asnReader.get(ip);
    console.log('\n--- Raw ASN Record ---');
    console.log(JSON.stringify(asnResult, null, 2));
  } else {
    console.log('ASN DB missing');
  }
}

const targetIp = process.argv[2] || '8.8.8.8';
debugLookup(targetIp).catch(console.error);
