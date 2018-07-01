'use strict';

const {Transform} = require('stream');

const depthIncrement = {startObject: 1, startArray: 1},
  depthDecrement = {endObject: 1, endArray: 1},
  opCodes = {
    startObject: 1,
    endObject: 7,
    startArray: 3,
    endArray: 2,
    nullValue: 0,
    trueValue: 5,
    falseValue: 4,
    endKey: 0
  };

const getNumberLength = n => {
  if (n < 0x1000000) {
    if (n < 0x10000) {
      return n < 0x100 ? 1 : 2;
    }
    return 3;
  }
  if (n < 0x10000000000) {
    return n < 0x100000000 ? 4 : 5;
  }
  return 6;
};

const getNumberType = n => {
  if (n === Math.floor(n)) {  // int/uint
    if (n < 0) {
      n = -n;
      if (n <= 0x800000) {
        if (n <= 0x8000) {
          return n <= 0x80 ? 1 : 2;
        }
        return 3;
      }
      if (n <= 0x8000000000) {
        return n <= 0x80000000 ? 4 : 5;
      }
      return 6;
    } else {
      if (n < 0x800000) {
        if (n < 0x8000) {
          return n < 0x80 ? 1 : 2;
        }
        return 3;
      }
      if (n < 0x8000000000) {
        return n < 0x80000000 ? 4 : 5;
      }
      return 6;
    }
  }
  // float
  return Float32Array.from([n])[0] === n ? 'float32' : 'float64';
}

class Encoder extends Transform {
  static make(options) {
    return new Encoder(options);
  }

  constructor(options) {
    super(Object.assign({}, options, {writableObjectMode: true, readableObjectMode: false}));

    this._values = {};
    let bufferSize = 0x10000;
    if (options) {
      'useValues' in options && (this._values.keyValue = this._values.stringValue = this._values.numberValue = options.useValues);
      'useKeyValues' in options && (this._values.keyValue = options.useKeyValues);
      'useStringValues' in options && (this._values.stringValue = options.useStringValues);
      'useNumberValues' in options && (this._values.numberValue = options.useNumberValues);
      'bufferSize' in options && !isNaN(options.bufferSize) && (bufferSize = Math.max(+options.bufferSize, 1024));
    }

    this._buffer = Buffer.alloc(bufferSize);
    this._index = 0;
    this._code = 0;
    this._codePos = 0;
    this._next = false;
    this._accumulator = '';
  }

  codeOp(op) {
    if (this._next) {
      this._buffer[this._codePos] = (this._code << 4) + op;
    } else {
      this._code = op;
      if (this._index + 1 === this._buffer.length) {
        this.push(this._buffer.slice(0, this._index));
        this._codePos = 0;
        this._index = 1;
      } else {
        this._codePos = this._index++;
      }
    }
    this._next = !this._next;
    return this;
  }

  codeNumber(n, length, method) {
    if (this._index + length > this._buffer.length) {
      const offset = this._next ? this._codePos : this._index;
      this.push(offset < this._buffer.length ? this._buffer.slice(0, offset) : this._buffer);
      if (this._next) {
        this._buffer.copy(this._buffer, 0, this._codePos, this._index);
        this._index -= this._codePos;
        this._codePos = 0;
      } else {
        this._index = 0;
      }
    }
    if (this._index + length > this._buffer.length) {
      if (this._next) {
        this._buffer[this._codePos] = (this._code << 4) + 14; // nop
        this._next = false;
      }
      this.push(this._buffer.slice(0, this._index));
      this._index = 0;
    }
    this._buffer[method](n, this._index, length);
    this._index += length;
    return this;
  }

  codeString(s, length) {
    if (this._index + length > this._buffer.length) {
      const offset = this._next ? this._codePos : this._index;
      this.push(offset < this._buffer.length ? this._buffer.slice(0, offset) : this._buffer);
      if (this._next) {
        this._buffer.copy(this._buffer, 0, this._codePos, this._index);
        this._index -= this._codePos;
        this._codePos = 0;
      } else {
        this._index = 0;
      }
    }
    if (this._index + length > this._buffer.length) {
      if (this._next) {
        this._buffer[this._codePos] = (this._code << 4) + 14; // nop
        this._next = false;
      }
      this.push(this._buffer.slice(0, this._index));
      this.push(Buffer.from(s));
      this._index = 0;
    } else {
      this._buffer.write(s, this._index);
      this._index += length;
    }
  }

  _transform(chunk, _, callback) {
    if (this._values[chunk.name]) {
      switch (chunk.name) {
        case 'keyValue':
          const length = Buffer.byteLength(chunk.value);
          if (length < 5) {
            this.codeOp(length);
          } else if (length < 16) {
            this.codeOp(5).codeOp(length);
          } else {
            this.codeOp(6).codeNumber(length, getNumberLength(length), 'writeUIntLE');
          }
          this.codeString(chunk.value, length);
          break;
        case 'stringValue':
          const length = Buffer.byteLength(chunk.value);
          if (length < 16) {
            this.codeOp(8).codeOp(length);
          } else {
            this.codeOp(9).codeNumber(length, getNumberLength(length), 'writeUIntLE');
          }
          this.codeString(chunk.value, length);
          break;
        case 'numberValue':
          const n = +chunk.value, type = getNumberType(n);
          if (type === 'float64') {
            this.codeOp(7);
            // write to buffer
          } else if (type === 'float32') {
            this.codeOp(6);
            // write to buffer
          } else {
            if (n < 16 && n>= 0) {
              this.codeOp(12).codeOp(n);
            } else {
              this.codeOp(13).codeNumber(n, type, 'writeIntLE');
            }
          }
          break;
      }
    } else {
      // filter out values
      switch (chunk.name) {
        case 'keyValue':
        case 'stringValue':
        case 'numberValue':
        case 'startNumber':
          // skip completely
          break;
        case 'startKey':
          this._expectingKey = true;
          break;
        case 'startString':
          this._expectingKey = false;
          break;
        case 'endString':
          this.codeOp(8).codeOp(0);
          break;
        case 'stringChunk':
          const length = Buffer.byteLength(chunk.value);
          if (this._expectingKey) {
            if (length < 5) {
              this.codeOp(8 + length);
            } else if (length < 16) {
              this.codeOp(13).codeOp(length);
            } else {
              this.codeOp(14).codeNumber(length, getNumberLength(length), 'writeUIntLE');
            }
          } else {
            if (length < 16) {
              this.codeOp(10).codeOp(length);
            } else {
              this.codeOp(11).codeNumber(length, getNumberLength(length), 'writeUIntLE');
            }
          }
          this.codeString(chunk.value, length);
          break;
        case 'numberChunk':
          this._accumulator += chunk.value;
          break;
        case 'endString':
          const n = +(this._accumulator + chunk.value), type = getNumberType(n);
          this._accumulator = '';
          if (type === 'float64') {
            this.codeOp(7);
            // write to buffer
          } else if (type === 'float32') {
            this.codeOp(6);
            // write to buffer
          } else {
            if (n < 16 && n>= 0) {
              this.codeOp(12).codeOp(n);
            } else {
              this.codeOp(13).codeNumber(n, type, 'writeIntLE');
            }
          }
          break;
        default: // startObject, endObject, startArray, endArray, nullValue, trueValue, falseValue, endKey
          this.codeOp(opCodes[chunk.name]);
          break;
      }
    }
    callback(null);
  }

  _flush(callback) {
    if (this._next) {
      this._buffer[this._codePos] = (this._code << 4) + 14; // nop
    }
    this._index > 0 && this.push(this._index < this._buffer.length ? this._buffer.slice(0, this._index) : this._buffer);
    callback(null);
  }
}
Encoder.encoder = Encoder.make;
Encoder.make.Constructor = Encoder;

module.exports = Encoder;
