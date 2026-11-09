import { registerParser, getParsers, parseSms } from './registry.js';
import { axisParser } from './issuers/axis.js';
import { iciciParser } from './issuers/icici.js';
import { hdfcParser } from './issuers/hdfc.js';
import { sbiParser, sbiMfParser } from './issuers/sbi.js';
import { idfcParser } from './issuers/idfc.js';
import { indusindParser } from './issuers/indusind.js';

// Parsers register themselves on import, but ensure they are registered here too
registerParser(axisParser);
registerParser(iciciParser);
registerParser(hdfcParser);
registerParser(sbiParser);
registerParser(sbiMfParser);
registerParser(idfcParser);
registerParser(indusindParser);

export { registerParser, getParsers, parseSms };

