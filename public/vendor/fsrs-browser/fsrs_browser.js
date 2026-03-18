import { startWorkers } from './snippets/wasm-bindgen-rayon-38edf6e439f6d70d/src/workerHelpers.js';

let wasm;

function addToExternrefTable0(obj) {
    const idx = wasm.__externref_table_alloc();
    wasm.__wbindgen_export_2.set(idx, obj);
    return idx;
}

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        const idx = addToExternrefTable0(e);
        wasm.__wbindgen_exn_store(idx);
    }
}

const cachedTextDecoder = (typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8', { ignoreBOM: true, fatal: true }) : { decode: () => { throw Error('TextDecoder not available') } } );

if (typeof TextDecoder !== 'undefined') { cachedTextDecoder.decode(); };

let cachedUint8ArrayMemory0 = null;

function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.buffer !== wasm.memory.buffer) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return cachedTextDecoder.decode(getUint8ArrayMemory0().slice(ptr, ptr + len));
}

let WASM_VECTOR_LEN = 0;

const cachedTextEncoder = (typeof TextEncoder !== 'undefined' ? new TextEncoder('utf-8') : { encode: () => { throw Error('TextEncoder not available') } } );

const encodeString = function (arg, view) {
    const buf = cachedTextEncoder.encode(arg);
    view.set(buf);
    return {
        read: arg.length,
        written: buf.length
    };
};

function passStringToWasm0(arg, malloc, realloc) {

    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }

    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = encodeString(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

let cachedDataViewMemory0 = null;

function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer !== wasm.memory.buffer) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedFloat32ArrayMemory0 = null;

function getFloat32ArrayMemory0() {
    if (cachedFloat32ArrayMemory0 === null || cachedFloat32ArrayMemory0.buffer !== wasm.memory.buffer) {
        cachedFloat32ArrayMemory0 = new Float32Array(wasm.memory.buffer);
    }
    return cachedFloat32ArrayMemory0;
}

function passArrayF32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getFloat32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

let cachedBigUint64ArrayMemory0 = null;

function getBigUint64ArrayMemory0() {
    if (cachedBigUint64ArrayMemory0 === null || cachedBigUint64ArrayMemory0.buffer !== wasm.memory.buffer) {
        cachedBigUint64ArrayMemory0 = new BigUint64Array(wasm.memory.buffer);
    }
    return cachedBigUint64ArrayMemory0;
}

function passArray64ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 8, 8) >>> 0;
    getBigUint64ArrayMemory0().set(arg, ptr / 8);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function _assertClass(instance, klass) {
    if (!(instance instanceof klass)) {
        throw new Error(`expected instance of ${klass.name}`);
    }
}

function getArrayF32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

let cachedUint32ArrayMemory0 = null;

function getUint32ArrayMemory0() {
    if (cachedUint32ArrayMemory0 === null || cachedUint32ArrayMemory0.buffer !== wasm.memory.buffer) {
        cachedUint32ArrayMemory0 = new Uint32Array(wasm.memory.buffer);
    }
    return cachedUint32ArrayMemory0;
}

function passArray32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getUint32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

export function start() {
    wasm.start();
}

/**
 * @param {number} num_threads
 * @returns {Promise<any>}
 */
export function initThreadPool(num_threads) {
    const ret = wasm.initThreadPool(num_threads);
    return ret;
}

/**
 * @param {number} receiver
 */
export function wbg_rayon_start_worker(receiver) {
    wasm.wbg_rayon_start_worker(receiver);
}

const FsrsFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_fsrs_free(ptr >>> 0, 1));

export class Fsrs {

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        FsrsFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_fsrs_free(ptr, 0);
    }
    /**
     * @param {Float32Array | null} [parameters]
     */
    constructor(parameters) {
        var ptr0 = isLikeNone(parameters) ? 0 : passArrayF32ToWasm0(parameters, wasm.__wbindgen_malloc);
        var len0 = WASM_VECTOR_LEN;
        const ret = wasm.fsrs_new(ptr0, len0);
        this.__wbg_ptr = ret >>> 0;
        FsrsFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * `minute_offset` should be the `user's timezone offset from UTC` minus `Anki's "next day starts at"`, in minutes.
     * @param {number} minute_offset
     * @param {BigInt64Array} cids
     * @param {Uint8Array} eases
     * @param {BigInt64Array} ids
     * @param {Uint8Array} types
     * @param {Progress | null | undefined} progress
     * @param {boolean} enable_short_term
     * @returns {Float32Array}
     */
    computeParametersAnki(minute_offset, cids, eases, ids, types, progress, enable_short_term) {
        const ptr0 = passArray64ToWasm0(cids, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(eases, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray64ToWasm0(ids, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArray8ToWasm0(types, wasm.__wbindgen_malloc);
        const len3 = WASM_VECTOR_LEN;
        let ptr4 = 0;
        if (!isLikeNone(progress)) {
            _assertClass(progress, Progress);
            ptr4 = progress.__destroy_into_raw();
        }
        const ret = wasm.fsrs_computeParametersAnki(this.__wbg_ptr, minute_offset, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, enable_short_term);
        var v6 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v6;
    }
    /**
     * @param {Uint32Array} ratings
     * @param {Uint32Array} delta_ts
     * @param {Uint32Array} lengths
     * @param {Progress | null | undefined} progress
     * @param {boolean} enable_short_term
     * @returns {Float32Array}
     */
    computeParameters(ratings, delta_ts, lengths, progress, enable_short_term) {
        const ptr = this.__destroy_into_raw();
        const ptr0 = passArray32ToWasm0(ratings, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray32ToWasm0(delta_ts, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray32ToWasm0(lengths, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        let ptr3 = 0;
        if (!isLikeNone(progress)) {
            _assertClass(progress, Progress);
            ptr3 = progress.__destroy_into_raw();
        }
        const ret = wasm.fsrs_computeParameters(ptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, enable_short_term);
        var v5 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v5;
    }
    /**
     * Returns an array of 2 elements: `[stability, difficulty]`
     * @param {Uint32Array} ratings
     * @param {Uint32Array} delta_ts
     * @returns {Float32Array}
     */
    memoryState(ratings, delta_ts) {
        const ptr0 = passArray32ToWasm0(ratings, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray32ToWasm0(delta_ts, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.fsrs_memoryState(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        var v3 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v3;
    }
    /**
     * `minute_offset` should be the `user's timezone offset from UTC` minus `Anki's "next day starts at"`, in minutes.
     * Returns an array of 2 elements: `[stability, difficulty]`
     * @param {number} minute_offset
     * @param {BigInt64Array} cids
     * @param {Uint8Array} eases
     * @param {BigInt64Array} ids
     * @param {Uint8Array} types
     * @returns {Float32Array | undefined}
     */
    memoryStateAnki(minute_offset, cids, eases, ids, types) {
        var ptr0 = passArray64ToWasm0(cids, wasm.__wbindgen_malloc);
        var len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(eases, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray64ToWasm0(ids, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArray8ToWasm0(types, wasm.__wbindgen_malloc);
        const len3 = WASM_VECTOR_LEN;
        const ret = wasm.fsrs_memoryStateAnki(this.__wbg_ptr, minute_offset, ptr0, len0, cids, ptr1, len1, ptr2, len2, ptr3, len3);
        let v5;
        if (ret[0] !== 0) {
            v5 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        }
        return v5;
    }
    /**
     * @param {number | null | undefined} stability
     * @param {number} desired_retention
     * @param {number} rating
     * @returns {number}
     */
    nextInterval(stability, desired_retention, rating) {
        const ret = wasm.fsrs_nextInterval(this.__wbg_ptr, isLikeNone(stability) ? 0x100000001 : Math.fround(stability), desired_retention, rating);
        return ret;
    }
    /**
     * @param {number | null | undefined} stability
     * @param {number | null | undefined} difficulty
     * @param {number} desired_retention
     * @param {number} days_elapsed
     * @returns {NextStates}
     */
    nextStates(stability, difficulty, desired_retention, days_elapsed) {
        const ret = wasm.fsrs_nextStates(this.__wbg_ptr, isLikeNone(stability) ? 0x100000001 : Math.fround(stability), isLikeNone(difficulty) ? 0x100000001 : Math.fround(difficulty), desired_retention, days_elapsed);
        return NextStates.__wrap(ret);
    }
}

const ItemStateFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_itemstate_free(ptr >>> 0, 1));

export class ItemState {

    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(ItemState.prototype);
        obj.__wbg_ptr = ptr;
        ItemStateFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ItemStateFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_itemstate_free(ptr, 0);
    }
    /**
     * @returns {MemoryState}
     */
    get memory() {
        const ret = wasm.__wbg_get_itemstate_memory(this.__wbg_ptr);
        return MemoryState.__wrap(ret);
    }
    /**
     * @param {MemoryState} arg0
     */
    set memory(arg0) {
        _assertClass(arg0, MemoryState);
        var ptr0 = arg0.__destroy_into_raw();
        wasm.__wbg_set_itemstate_memory(this.__wbg_ptr, ptr0);
    }
    /**
     * @returns {number}
     */
    get interval() {
        const ret = wasm.__wbg_get_itemstate_interval(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} arg0
     */
    set interval(arg0) {
        wasm.__wbg_set_itemstate_interval(this.__wbg_ptr, arg0);
    }
}

const MemoryStateFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_memorystate_free(ptr >>> 0, 1));

export class MemoryState {

    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(MemoryState.prototype);
        obj.__wbg_ptr = ptr;
        MemoryStateFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        MemoryStateFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_memorystate_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    get stability() {
        const ret = wasm.__wbg_get_memorystate_stability(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} arg0
     */
    set stability(arg0) {
        wasm.__wbg_set_memorystate_stability(this.__wbg_ptr, arg0);
    }
    /**
     * @returns {number}
     */
    get difficulty() {
        const ret = wasm.__wbg_get_memorystate_difficulty(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} arg0
     */
    set difficulty(arg0) {
        wasm.__wbg_set_memorystate_difficulty(this.__wbg_ptr, arg0);
    }
}

const NextStatesFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_nextstates_free(ptr >>> 0, 1));

export class NextStates {

    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(NextStates.prototype);
        obj.__wbg_ptr = ptr;
        NextStatesFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        NextStatesFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_nextstates_free(ptr, 0);
    }
    /**
     * @returns {ItemState}
     */
    get again() {
        const ret = wasm.__wbg_get_nextstates_again(this.__wbg_ptr);
        return ItemState.__wrap(ret);
    }
    /**
     * @param {ItemState} arg0
     */
    set again(arg0) {
        _assertClass(arg0, ItemState);
        var ptr0 = arg0.__destroy_into_raw();
        wasm.__wbg_set_nextstates_again(this.__wbg_ptr, ptr0);
    }
    /**
     * @returns {ItemState}
     */
    get hard() {
        const ret = wasm.__wbg_get_nextstates_hard(this.__wbg_ptr);
        return ItemState.__wrap(ret);
    }
    /**
     * @param {ItemState} arg0
     */
    set hard(arg0) {
        _assertClass(arg0, ItemState);
        var ptr0 = arg0.__destroy_into_raw();
        wasm.__wbg_set_nextstates_hard(this.__wbg_ptr, ptr0);
    }
    /**
     * @returns {ItemState}
     */
    get good() {
        const ret = wasm.__wbg_get_nextstates_good(this.__wbg_ptr);
        return ItemState.__wrap(ret);
    }
    /**
     * @param {ItemState} arg0
     */
    set good(arg0) {
        _assertClass(arg0, ItemState);
        var ptr0 = arg0.__destroy_into_raw();
        wasm.__wbg_set_nextstates_good(this.__wbg_ptr, ptr0);
    }
    /**
     * @returns {ItemState}
     */
    get easy() {
        const ret = wasm.__wbg_get_nextstates_easy(this.__wbg_ptr);
        return ItemState.__wrap(ret);
    }
    /**
     * @param {ItemState} arg0
     */
    set easy(arg0) {
        _assertClass(arg0, ItemState);
        var ptr0 = arg0.__destroy_into_raw();
        wasm.__wbg_set_nextstates_easy(this.__wbg_ptr, ptr0);
    }
}

const ProgressFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_progress_free(ptr >>> 0, 1));

export class Progress {

    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(Progress.prototype);
        obj.__wbg_ptr = ptr;
        ProgressFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ProgressFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_progress_free(ptr, 0);
    }
    /**
     * @returns {Progress}
     */
    static new() {
        const ret = wasm.progress_new();
        return Progress.__wrap(ret);
    }
    /**
     * Memory will hold [items_processed, items_total]
     * @returns {number}
     */
    pointer() {
        const ret = wasm.progress_pointer(this.__wbg_ptr);
        return ret >>> 0;
    }
}

const wbg_rayon_PoolBuilderFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wbg_rayon_poolbuilder_free(ptr >>> 0, 1));

export class wbg_rayon_PoolBuilder {

    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(wbg_rayon_PoolBuilder.prototype);
        obj.__wbg_ptr = ptr;
        wbg_rayon_PoolBuilderFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        wbg_rayon_PoolBuilderFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wbg_rayon_poolbuilder_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    numThreads() {
        const ret = wasm.wbg_rayon_poolbuilder_numThreads(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    receiver() {
        const ret = wasm.wbg_rayon_poolbuilder_receiver(this.__wbg_ptr);
        return ret >>> 0;
    }
    build() {
        wasm.wbg_rayon_poolbuilder_build(this.__wbg_ptr);
    }
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);

            } catch (e) {
                if (module.headers.get('Content-Type') != 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else {
                    throw e;
                }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);

    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };

        } else {
            return instance;
        }
    }
}

function __wbg_get_imports() {
    const imports = {};
    imports.wbg = {};
    imports.wbg.__wbg_buffer_609cc3eee51ed158 = function(arg0) {
        const ret = arg0.buffer;
        return ret;
    };
    imports.wbg.__wbg_call_672a4d21634d4a24 = function() { return handleError(function (arg0, arg1) {
        const ret = arg0.call(arg1);
        return ret;
    }, arguments) };
    imports.wbg.__wbg_debug_3cb59063b29f58c1 = function(arg0) {
        console.debug(arg0);
    };
    imports.wbg.__wbg_error_524f506f44df1645 = function(arg0) {
        console.error(arg0);
    };
    imports.wbg.__wbg_error_7534b8e9a36f1ab4 = function(arg0, arg1) {
        let deferred0_0;
        let deferred0_1;
        try {
            deferred0_0 = arg0;
            deferred0_1 = arg1;
            console.error(getStringFromWasm0(arg0, arg1));
        } finally {
            wasm.__wbindgen_free(deferred0_0, deferred0_1, 1);
        }
    };
    imports.wbg.__wbg_getRandomValues_994e6d041c9fc2c1 = function() { return handleError(function (arg0) {
        globalThis.crypto.getRandomValues(arg0);
    }, arguments) };
    imports.wbg.__wbg_info_3daf2e093e091b66 = function(arg0) {
        console.info(arg0);
    };
    imports.wbg.__wbg_instanceof_Window_def73ea0955fc569 = function(arg0) {
        let result;
        try {
            result = arg0 instanceof Window;
        } catch (_) {
            result = false;
        }
        const ret = result;
        return ret;
    };
    imports.wbg.__wbg_length_a446193dc22c12f8 = function(arg0) {
        const ret = arg0.length;
        return ret;
    };
    imports.wbg.__wbg_log_c222819a41e063d3 = function(arg0) {
        console.log(arg0);
    };
    imports.wbg.__wbg_new_8a6f238a6ece86ea = function() {
        const ret = new Error();
        return ret;
    };
    imports.wbg.__wbg_new_a12002a7f91c75be = function(arg0) {
        const ret = new Uint8Array(arg0);
        return ret;
    };
    imports.wbg.__wbg_newnoargs_105ed471475aaf50 = function(arg0, arg1) {
        const ret = new Function(getStringFromWasm0(arg0, arg1));
        return ret;
    };
    imports.wbg.__wbg_newwithlength_a381634e90c276d4 = function(arg0) {
        const ret = new Uint8Array(arg0 >>> 0);
        return ret;
    };
    imports.wbg.__wbg_set_65595bdd868b3009 = function(arg0, arg1, arg2) {
        arg0.set(arg1, arg2 >>> 0);
    };
    imports.wbg.__wbg_stack_0ed75d68575b0f3c = function(arg0, arg1) {
        const ret = arg1.stack;
        const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
        getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
    };
    imports.wbg.__wbg_startWorkers_2ca11761e08ff5d5 = function(arg0, arg1, arg2) {
        const ret = startWorkers(arg0, arg1, wbg_rayon_PoolBuilder.__wrap(arg2));
        return ret;
    };
    imports.wbg.__wbg_static_accessor_GLOBAL_88a902d13a557d07 = function() {
        const ret = typeof global === 'undefined' ? null : global;
        return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
    };
    imports.wbg.__wbg_static_accessor_GLOBAL_THIS_56578be7e9f832b0 = function() {
        const ret = typeof globalThis === 'undefined' ? null : globalThis;
        return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
    };
    imports.wbg.__wbg_static_accessor_SELF_37c5d418e4bf5819 = function() {
        const ret = typeof self === 'undefined' ? null : self;
        return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
    };
    imports.wbg.__wbg_static_accessor_WINDOW_5de37043a91a9c40 = function() {
        const ret = typeof window === 'undefined' ? null : window;
        return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
    };
    imports.wbg.__wbg_warn_4ca3906c248c47c4 = function(arg0) {
        console.warn(arg0);
    };
    imports.wbg.__wbindgen_copy_to_typed_array = function(arg0, arg1, arg2) {
        new Uint8Array(arg2.buffer, arg2.byteOffset, arg2.byteLength).set(getArrayU8FromWasm0(arg0, arg1));
    };
    imports.wbg.__wbindgen_init_externref_table = function() {
        const table = wasm.__wbindgen_export_2;
        const offset = table.grow(4);
        table.set(0, undefined);
        table.set(offset + 0, undefined);
        table.set(offset + 1, null);
        table.set(offset + 2, true);
        table.set(offset + 3, false);
        ;
    };
    imports.wbg.__wbindgen_is_undefined = function(arg0) {
        const ret = arg0 === undefined;
        return ret;
    };
    imports.wbg.__wbindgen_memory = function() {
        const ret = wasm.memory;
        return ret;
    };
    imports.wbg.__wbindgen_module = function() {
        const ret = __wbg_init.__wbindgen_wasm_module;
        return ret;
    };
    imports.wbg.__wbindgen_string_new = function(arg0, arg1) {
        const ret = getStringFromWasm0(arg0, arg1);
        return ret;
    };
    imports.wbg.__wbindgen_throw = function(arg0, arg1) {
        throw new Error(getStringFromWasm0(arg0, arg1));
    };

    return imports;
}

function __wbg_init_memory(imports, memory) {
    imports.wbg.memory = memory || new WebAssembly.Memory({initial:18,maximum:16384,shared:true});
}

function __wbg_finalize_init(instance, module, thread_stack_size) {
    wasm = instance.exports;
    __wbg_init.__wbindgen_wasm_module = module;
    cachedBigUint64ArrayMemory0 = null;
    cachedDataViewMemory0 = null;
    cachedFloat32ArrayMemory0 = null;
    cachedUint32ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;

    if (typeof thread_stack_size !== 'undefined' && (typeof thread_stack_size !== 'number' || thread_stack_size === 0 || thread_stack_size % 65536 !== 0)) { throw 'invalid stack size' }
    wasm.__wbindgen_start(thread_stack_size);
    return wasm;
}

function initSync(module, memory) {
    if (wasm !== undefined) return wasm;

    let thread_stack_size
    if (typeof module !== 'undefined') {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module, memory, thread_stack_size} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();

    __wbg_init_memory(imports, memory);

    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }

    const instance = new WebAssembly.Instance(module, imports);

    return __wbg_finalize_init(instance, module, thread_stack_size);
}

async function __wbg_init(module_or_path, memory) {
    if (wasm !== undefined) return wasm;

    let thread_stack_size
    if (typeof module_or_path !== 'undefined') {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path, memory, thread_stack_size} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (typeof module_or_path === 'undefined') {
        module_or_path = new URL('fsrs_browser_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    __wbg_init_memory(imports, memory);

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module, thread_stack_size);
}

export { initSync };
export default __wbg_init;

/**
* Do not use this function after the completion of `computeParameters` or `computeParametersAnki`.
* Data returned after completion will be random!
*/
export function getProgress(wasmMemoryBuffer, pointer) {
    // The progress vec is length 2. Grep 2291AF52-BEE4-4D54-BAD0-6492DFE368D8
    var progress = new Uint32Array(wasmMemoryBuffer, pointer, 2);
    return {
        itemsProcessed: progress[0],
        itemsTotal: progress[1],
    };
}

