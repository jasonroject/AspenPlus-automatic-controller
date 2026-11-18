import {receive,send} from './translation-helper.mjs';const g=(await taskSpace(1)).page('p2');await receive(g,1);await send(g,2);
