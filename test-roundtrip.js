const {encoder} = require('./Encoder');
const {decoder} = require('./Decoder');

const unify = require('heya-unify');

const {disassembler} = require('stream-json/Disassembler');
const Assembler = require('stream-json/Assembler');

const run = x => {
  const disasm = disassembler();
  const enc = encoder();
  const dec = decoder();
  const pipeline = disasm.pipe(enc).pipe(dec);
  const asm = Assembler.connectTo(pipeline);

  disasm.on('error', err => console.log(err));
  enc.on('error', err => console.log(err));
  dec.on('error', err => console.log(err));
  asm.on('error', err => console.log(err));

  asm.on('done', asm => {
    if (unify(x, asm.current)) {
      console.log('identical');
    } else {
      console.log(x);
      console.log(asm.current);
    }
  });

  disasm.end(x);
};

// run(true);
// run(false);
// run('a');
// run('abcdefghijklmnopqrstuvwxyz');
// run(1);
// run(42);
// run(1234567890);
// run(0x1122334455);
// run(-0x1122334455);
// run(12.5);
// run(Math.PI);
// run([]);
// run([1,2,3]);
// run([[]]);
// run([null]);
// run({});
// run({a: 1});
// run({a: 'b'});
// run({a: {b: []}});
// run({a: {}, b: []});
run({abracodabra: {}, barmaley: [], oranges: 42, peaches: 2.5, 'ананасы': 'пастеризация'});
