import { decodeKeys, KEY_MAP } from '../protocol/keyMap.js';
import { buildProfileCmds } from '../protocol/buildProfile.js';
import { puffBytes, toHex } from '../protocol/binary.js';
import fs from 'fs';

const eco = JSON.parse(fs.readFileSync(new URL('../userHeatProfile/Eco.json', import.meta.url), 'utf8'));
const d = decodeKeys(eco.heatProfileData);
console.log('KEY_MAP size', Object.keys(KEY_MAP).length);
console.log('profileNum', d.profileNum, 'filter1', d.filter1, 'leaflet0', d.leaflet0, 'soc100', d.soc100);
console.log('step02', d.step02);
console.log('puff bytes', toHex(puffBytes(d.step02.puffThreshold)));

const master = [
  1, 1537, 1509, 1503, 2423, 2419, 1912, 1227, 1220, 1119, 1454, 1059, 3203, 3192, 1585, 1022, 521, 595, 595,
  3512,
];
const cmds4 = buildProfileCmds(d, master, 4);
const cmds3 = buildProfileCmds(d, master, 3);
console.log('gen4 cmds', cmds4.length, 'cmd0', toHex(cmds4[0]));
console.log('gen3 cmds', cmds3.length, 'cmd0', toHex(cmds3[0]));
console.log('gen4 cmd20', toHex(cmds4[20]));
console.log('unmapped leftover keys?', Object.keys(d).filter((k) => k.length <= 2).slice(0, 10));
