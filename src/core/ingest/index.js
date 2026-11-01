import { registerParser, getParsers, parseSms } from './registry.js';
import { axisParser } from './issuers/axis.js';
import { iciciParser } from './issuers/icici.js';
import { hdfcParser } from './issuers/hdfc.js';

// Parsers register themselves on import, but ensure they are registered here too
registerParser(axisParser);
registerParser(iciciParser);
registerParser(hdfcParser);

export { registerParser, getParsers, parseSms };

