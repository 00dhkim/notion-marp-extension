// rollup.config.js
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import polyfillNode from 'rollup-plugin-polyfill-node';
import json from '@rollup/plugin-json';

export default {
  input: 'background.js',
  output: { dir: 'dist', format: 'esm' },
  plugins: [
    json(),
    resolve({ browser: true, preferBuiltins: false }),
    commonjs(),
    polyfillNode(),          // ← 추가
  ],
};
