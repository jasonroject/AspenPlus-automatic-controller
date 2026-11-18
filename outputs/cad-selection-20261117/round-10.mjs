import {setup,fs,base} from './helpers.mjs';const p=(await taskSpace(1)).page('p1');await setup(p);await p.click('.view-switch button >> nth=0');console.log(await p.snapshot());
