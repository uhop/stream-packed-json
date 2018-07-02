const {encoder} = require('./Encoder');

const {disassembler} = require('stream-json/Disassembler');

const disasm = disassembler();
const e = encoder({useValues: true});

e.on('error', err => console.log(err));
e.on('data', buf => console.log(buf));

disasm.pipe(e);

// disasm.end(true);
// disasm.end(false);
// disasm.write(true); disasm.end(false);
// disasm.end('a');
disasm.end('abcdefghijklmnopqrstuvwxyz');
// disasm.end(1);
// disasm.end(42);
// disasm.end(1234567890);
// disasm.end(0x1122334455);
// disasm.end(-0x1122334455);
// disasm.end(12.5);
// disasm.end(Math.PI);
// disasm.end([]);
// disasm.end([1,2,3]);
// disasm.end([[]]);
// disasm.end([null]);
// disasm.end({});
// disasm.end({a: 1});
// disasm.end({a: {b: []}});
// disasm.end({a: {}, b: []});
