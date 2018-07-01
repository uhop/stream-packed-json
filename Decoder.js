'use strict';

const {Transform} = require('stream');

class Decoder extends Transform {
  static make(options) {
    return new Decoder(options);
  }

  constructor(options) {
    super(Object.assign({}, options, {writableObjectMode: false, readableObjectMode: true}));

    this._packKeys = this._packStrings = this._packNumbers = this._streamKeys = this._streamStrings = this._streamNumbers = true;
    if (options) {
      'packValues' in options && (this._packKeys = this._packStrings = this._packNumbers = options.packValues);
      'packKeys' in options && (this._packKeys = options.packKeys);
      'packStrings' in options && (this._packStrings = options.packStrings);
      'packNumbers' in options && (this._packNumbers = options.packNumbers);
      'streamValues' in options && (this._streamKeys = this._streamStrings = this._streamNumbers = options.streamValues);
      'streamKeys' in options && (this._streamKeys = options.streamKeys);
      'streamStrings' in options && (this._streamStrings = options.streamStrings);
      'streamNumbers' in options && (this._streamNumbers = options.streamNumbers);
    }
    !this._packKeys && (this._streamKeys = true);
    !this._packStrings && (this._streamStrings = true);
    !this._packNumbers && (this._streamNumbers = true);

    this._buffer = null;
    this._done = false;
    this._expect = 'value';
    this._stack = [];
    // codes
    this._nextCode = 0;
    this._next = false;
    // strings
    this._accumulator = '';
    this._originalCode = 0;
    this._isFirstChunk = true;
  }

  _transform(chunk, encoding, callback) {
    this._buffer = this._buffer ? Buffer.concat(this._buffer, chunk) : chunk;
    this._processInput(callback);
  }

  _flush(callback) {
    this._done = true;
    this._processInput(callback);
  }

  _processInput(callback) {
    let value,
      code,
      index = 0;
    main: for (;;) {
      if (this._expect === 'string') {
        // process strings
        if (index + this._counter > this._buffer.length) {
          if (this._done) return callback(new Error('Cannot read a string'));
          break main; // wait for more input
        }
        const v = this._buffer.toString('utf8', index, index + this._counter),
          isKey = this._stack.length && this._stack[this._stack.length - 1];
        index += this._counter;
        if (isKey) {
          if (this._isFirstChunk) {
            this._streamKeys && this.push({name: 'startKey'});
            this._isFirstChunk = false;
          }
          if (this._originalCode & 2) {
            // not the last chunk
            this._streamKeys && this.push({name: 'stringChunk', value: v});
            this._packKeys && (this._accumulator += v);
            this._expect = 'key';
          } else {
            // the last chunk
            if (this._streamKeys) {
              this.push({name: 'stringChunk', value: v});
              this.push({name: 'endKey'});
              this._isFirstChunk = true;
            }
            if (this._packKeys) {
              this.push({name: 'keyValue', value: this._accumulator + v});
              this._accumulator = '';
            }
            this._expect = 'value';
          }
        } else {
          if (this._isFirstChunk) {
            this._streamStrings && this.push({name: 'startString'});
            this._isFirstChunk = false;
          }
          if (this._originalCode & 2) {
            // not the last chunk
            this._streamStrings && this.push({name: 'stringChunk', value: v});
            this._packStrings && (this._accumulator += v);
          } else {
            // the last chunk
            if (this._streamStrings) {
              this.push({name: 'stringChunk', value: v});
              this.push({name: 'endString'});
              this._isFirstChunk = true;
            }
            if (this._packStrings) {
              this.push({name: 'stringValue', value: this._accumulator + v});
              this._accumulator = '';
            }
          }
          this._expect = 'value';
        }
        continue;
      }
      if (this._expect === 'done') {
        // ignore the stream after EOF
        index = this._buffer.length;
        break main; // wait for more input
      }

      // extract a code
      if (this._next) {
        code = this._nextCode;
      } else {
        if (index >= this._buffer.length) {
          if (this._done && (this._expect !== 'value' || this._stack.length)) return callback(new Error('Cannot read a code'));
          break main; // wait for more input
        }
        value = this._buffer[index++];
        code = value >> 4;
        this._nextCode = value & 0x0f;
      }
      this._next = !this._next;

      // process a code
      switch (this._expect) {
        case 'value':
          switch (code) {
            case 0: // null
              this.push({name: 'nullValue', value: null});
              break;
            case 1: // object
              this.push({name: 'startObject'});
              this._stack.push(true);
              this._expect = 'key';
              continue;
            case 2: // end of array
              this.push({name: 'endArray'});
              this._stack.pop();
              break;
            case 3: // array
              this.push({name: 'startArray'});
              this._stack.push(false);
              break;
            case 4: // false
              this.push({name: 'falseValue', value: false});
              break;
            case 5: // true
              this.push({name: 'trueValue', value: true});
              break;
            case 6: // float32
            case 7: // float64
              const length = code === 7 ? 8 : 4;
              if (index + length > this._buffer.length) {
                if (this._done) return callback(new Error('Cannot read float32'));
                break main; // wait for more input
              }
              const data = this._buffer[code === 7 ? 'readDoubleLE' : 'readFloatLE'](index);
              index += length;
              const v = data.toString();
              if (this._streamNumbers) {
                this.push({name: 'startNumber'});
                this.push({name: 'numberChunk', value: v});
                this.push({name: 'endNumber'});
              }
              this._packNumbers && this.push({name: 'numberValue', value: v});
              break;
            default:
              this._expect = 'bytes';
              this._originalCode = code;
              continue;
          }
          break;
        case 'key':
          if (code === 7) {
            // end of object
            this.push({name: 'endObject'});
            this._stack.pop();
            break;
          }
          const length = code & 7;
          if (length === 6) {
            // external length
            this._expect = 'bytes';
            this._originalCode = 13 + (code & 8 ? 2 : 0);
            continue;
          }
          if (!length) {
            if (this._streamKeys) {
              this.push({name: 'startKey'});
              this.push({name: 'endKey'});
            }
            this._packKeys && this.push({name: 'keyValue', value: ''});
            break;
          }
          this._expect = 'string';
          this._counter = length;
          continue;
        case 'bytes': // string, number, or EOF
          if (this._originalCode === 15 && code === 15) {
            // EOF
            if (this._stack.length) return callback(new Error('Premature EOF'));
            this._expect = 'done';
            continue;
          }
          let n = code;
          if (this._originalCode & 1) {
            // external length
            if (index + n > this._buffer.length) {
              if (this._done) return callback(new Error('Cannot read a number'));
              break main; // wait for more input
            }
            const length = n;
            n = this._buffer[(this._originalCode & 6) === 2 ? 'readIntLE' : 'readUIntLE'](index, length);
            index += length;
          }
          if (this._originalCode & 4) {
            // string
            const isKey = this._stack.length && this._stack[this._stack.length - 1];
            if (!n) {
              if (isKey) {
                if (this._streamKeys) {
                  this.push({name: 'startKey'});
                  this.push({name: 'endKey'});
                }
                this._packKeys && this.push({name: 'keyValue', value: ''});
                this._expect = 'value';
              } else {
                if (this._streamStrings) {
                  this.push({name: 'startString'});
                  this.push({name: 'endString'});
                }
                this._packStrings && this.push({name: 'stringValue', value: ''});
                if (this._stack.length && this._stack[this._stack.length - 1] === 'value') {
                  this._expect = 'key';
                }
              }
              break;
            }
            this._expect = 'string';
            this._counter = n;
            continue;
          } else {
            // number
            const v = n.toString();
            if (this._streamNumbers) {
              this.push({name: 'startNumber'});
              this.push({name: 'numberChunk', value: v});
              this.push({name: 'endNumber'});
            }
            this._packNumbers && this.push({name: 'numberValue', value: v});
          }
          break;
      }

      // define next expected value
      this._expect = this._stack.length && this._stack[this._stack.length - 1] ? 'key' : 'value';
    }

    // clean up
    this._buffer = index < this._buffer.length ? this._buffer.slice(index) : Buffer.from('');

    callback(null);
  }
}
Decoder.decoder = Decoder.make;
Decoder.make.Constructor = Decoder;

module.exports = Decoder;
