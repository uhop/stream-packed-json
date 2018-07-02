const {decoder} = require('./Decoder');

const d = decoder();

d.on('error', err => console.log(err));
d.on('data', token => console.log(token));

// d.end(Buffer.from([0x17])); // {}
d.end(Buffer.from([0x3c, 0x1c, 0x2d, 0x22, 0x38, 0x42])); // [1, 2, 16952]
// d.end(Buffer.from([0x05, 0x4f, 0xf0])); // null, true, false
// d.end(Buffer.from([0x11, 'a'.charCodeAt(0), 0x31, 0x13, 'b'.charCodeAt(0), 0x27, 0x27])); // {a: [{b: []}]}
