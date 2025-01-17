import crypto from 'crypto'
import { compact } from 'underscore'

/** Helper function to force the input to be of a certain type. */
export function literal<T>(o: T): T {
	return o
}
/**
 * Returns a string that changes whenever the input changes.
 * Does NOT depend on the order of object attributes.
 */
export function hashObj(obj: unknown): string {
	if (!obj) {
		return ''
	} else if (Array.isArray(obj)) {
		const strs: string[] = []
		for (const value of obj) {
			strs.push(hashObj(value))
		}
		return hash(strs.join(','))
	} else if (typeof obj === 'object') {
		if (!obj) return 'null'

		// Sort the keys, so that key order doesn't matter:
		const keys = Object.keys(obj).sort((a, b) => {
			if (a > b) return 1
			if (a < b) return -1
			return 0
		})

		const strs: string[] = []
		for (const key of keys) {
			strs.push(hashObj((obj as any)[key]))
		}
		return hash(strs.join('|'))
	} else {
		return obj + ''
	}
}
export function hash(str: string): string {
	const hash0 = crypto.createHash('sha1')
	return hash0.update(str).digest('hex')
}
/** Helper function to simply assert that the value is of the type never */
export function assertNever(_value: never): void {
	// does nothing
}
export async function waitTime(duration: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, duration)
	})
}
/** Intercepts a promise and rejects if the promise doesn't resolve in time. */
export async function promiseTimeout<T>(
	p: Promise<T>,
	timeoutTime: number,
	timeoutMessage?: string | ((timeoutDuration: number) => string)
): Promise<T> {
	const startTime = Date.now()
	return new Promise<T>((resolve, reject) => {
		const timeout = setTimeout(() => {
			const duration = Date.now() - startTime
			const msg = typeof timeoutMessage === 'function' ? timeoutMessage(duration) : timeoutMessage
			reject(msg || 'Timeout')
		}, timeoutTime)

		Promise.resolve(p)
			.then(resolve)
			.catch(reject)
			.finally(() => {
				clearTimeout(timeout)
			})
	})
}
/**
 * Does a deep comparison to see if the properties of the objects are equal.
 * @returns true if objects are equal
 */
export function deepEqual<T>(object1: T, object2: T): boolean {
	const areObjects = isObject(object1) && isObject(object2)
	if (areObjects) {
		if (Array.isArray(object1) !== Array.isArray(object2)) return false

		const keys1 = Object.keys(object1)
		const keys2 = Object.keys(object2)
		if (keys1.length !== keys2.length) return false

		for (const key of keys1) {
			if (!deepEqual((object1 as any)[key], (object2 as any)[key])) {
				return false
			}
		}

		return true
	} else {
		return object1 === object2
	}
}
function isObject(obj: unknown): obj is { [key: string]: any } {
	return obj != null && typeof obj === 'object'
}
/** Make a string out of an error, including any additional data such as stack trace if available */
export function stringifyError(error: unknown, noStack = false): string {
	let str = `${error}`

	if (error && typeof error === 'object' && (error as any).reason) {
		str = `${(error as any).reason}`
	}
	if (error && typeof error === 'object' && (error as any).context) {
		str += `, Context: ${(error as any).context}`
	}

	if (!noStack) {
		if (error && typeof error === 'object' && (error as any).stack) {
			str += ', ' + (error as any).stack
		}
	}

	if (str === '[object Object]') {
		// A last try to make something useful:
		try {
			str = JSON.stringify(error)
			if (str.length > 200) {
				str = str.slice(0, 200) + '...'
			}
		} catch (e) {
			str = '[Error in stringifyError: Failed to stringify]'
		}
	}
	return str
}
/**
 * Results in a _true_ type if the provided types are identical.
 * https://github.com/Microsoft/TypeScript/issues/27024#issuecomment-421529650
 */
export type Equals<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false

/**
 * Results in a _true_ type if the Enum A extends enum B
 * Usage: EnumExtends<typeof A, typeof B>
 */
export type EnumExtends<A, B> = keyof B extends keyof A ? true : false

/** Assert that the values in enum a is present in enum b */
export function assertEnumValuesExtends(
	checkedEnum: { [key: string]: any },
	extendedEnum: { [key: string]: any }
): void {
	for (const key in extendedEnum) {
		if (checkedEnum[key] !== extendedEnum[key]) {
			throw new Error(`${key} is not equal`)
		}
	}
}

/** (Type-check) Assert that the type provided is true. */
// @ts-expect-error T is never used
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function assertTrue<T extends true>(): void {
	// Nothing, this is a type guard only
}

/**
 * Does a deep comparison between two objects, returns the first difference found
 * @param a
 * @param b
 * @param omitKeys (Optional) An array of properties(-paths) to ignore. e.g. ["a", "a.b", "list.1"].
 * 	"*" matches any key, useful for example in arrays: "list.*.ignoreMe"
 * @returns a string describing the first thing found that makes the two values different, null if no differences are found.
 */
export function diff<T>(a: T, b: T, omitKeys?: string[]): string | null {
	let omitKeysMap: { [key: string]: true } | undefined
	if (omitKeys && omitKeys.length) {
		omitKeysMap = {}
		for (const omitKey of omitKeys) {
			omitKeysMap[omitKey] = true
		}
	} else {
		omitKeysMap = undefined
	}

	const innerDiff = diffInner(a, b, omitKeysMap)
	if (innerDiff) {
		return (innerDiff[1].length ? `${innerDiff[1].join('.')}: ` : '') + innerDiff[0]
	}
	return null
}
/** Returns [ 'diff explanation', [path] ] */
function diffInner(
	a: unknown,
	b: unknown,
	omitKeysMap: { [key: string]: true } | undefined
): [string, string[]] | null {
	if (a === b) return null

	if (a == null || b == null || a == undefined || b == undefined) return [`${a} !== ${b}`, []] // Reduntant, gives nicer output for null & undefined

	const typeofA = typeof a
	const typeofB = typeof b
	if (typeofA !== typeofB) return [`type ${typeofA} !== ${typeofB}`, []]

	if (typeofA === 'object' && typeofB === 'object') {
		if (a === null && b === null) return null
		if (a === null || b === null) return [`${a} !== ${b}`, []]

		const isArrayA = Array.isArray(a)
		const isArrayB = Array.isArray(b)
		if (isArrayA || isArrayB) {
			if (!isArrayA || !isArrayB) {
				if (isArrayA) return [`array !== object`, []]
				else return [`object !== array`, []]
			}

			if (a.length !== b.length) return [`length: ${a.length} !== ${b.length}`, []]
		}

		const checkedKeys: { [key: string]: true } = {}
		for (const key of Object.keys(a as any).concat(Object.keys(b as any))) {
			if (checkedKeys[key]) continue // already checked this key
			if (omitKeysMap && omitKeysMap[key]) continue // ignore this key

			// const innerPath = pathOrg ? `${pathOrg}.${key}` : `${key}`

			let omitKeysMapInner: { [key: string]: true } | undefined
			if (omitKeysMap) {
				omitKeysMapInner = {}
				const replaceKey = key + '.'
				for (const omitKey of Object.keys(omitKeysMap)) {
					// "a.b.c" => "b.c"
					if (omitKey.startsWith(replaceKey)) {
						const innerKey = omitKey.slice(replaceKey.length)
						if (innerKey) omitKeysMapInner[innerKey] = true
					} else if (omitKey.startsWith('*.')) {
						const innerKey = omitKey.slice(2)
						if (innerKey) omitKeysMapInner[innerKey] = true
					}
					// else: the key can be omitted
				}
			} else {
				omitKeysMapInner = undefined
			}

			// @ts-expect-error keys
			const innerDiff = diffInner(a[key], b[key], omitKeysMapInner)
			if (innerDiff) {
				return [innerDiff[0], [key, ...innerDiff[1]]]
			}

			checkedKeys[key] = true
		}

		// if (keys.length !== Object.keys(b).length) return 'different number of keys'
		return null
	}
	return [`${a} !== ${b}`, []]
}

export function isNodeRunningInDebugMode(): boolean {
	return (
		// @ts-expect-error v8debug is a NodeJS global
		typeof v8debug === 'object' || /--debug|--inspect/.test(process.execArgv.join(' ') + process.env.NODE_OPTIONS)
	)
}

/**
 * Wraps a function, so that multiple calls to it will be grouped together,
 * if the calls are close enough in time so that the resulting promise havent resolved yet.
 * The subsequent calls will resolve with the same result as the first call.
 */
export function deferGets<Args extends any[], Result>(
	fcn: (...args: Args) => Promise<Result>
): (groupId: string, ...args: Args) => Promise<Result> {
	const defers = new Map<
		string,
		{
			resolve: (value: Result) => void
			reject: (err: any) => void
		}[]
	>()

	return async (groupId: string, ...args: Args) => {
		return new Promise<Result>((resolve, reject) => {
			// Check if there already is a call waiting:
			const waiting = defers.get(groupId)
			if (waiting) {
				waiting.push({ resolve, reject })
			} else {
				const newWaiting = [{ resolve, reject }]
				defers.set(groupId, newWaiting)

				fcn(...args)
					.then((result) => {
						defers.delete(groupId)
						for (const w of newWaiting) {
							w.resolve(result)
						}
					})
					.catch((err) => {
						defers.delete(groupId)
						for (const w of newWaiting) {
							w.reject(err)
						}
					})
			}
		})
	}
}
export function ensureArray<T>(v: T | (T | undefined)[]): T[] {
	return compact(Array.isArray(v) ? v : [v])
}
export function first<T>(v: T | (T | undefined)[]): T | undefined {
	return ensureArray(v)[0]
}
/** Shallowly remove undefined properties from an object */
export function removeUndefinedProperties<T extends { [key: string]: unknown } | undefined>(o: T): T {
	if (!o) return o
	if (typeof o !== 'object') return o

	const o2: { [key: string]: unknown } = {}
	for (const [key, value] of Object.entries(o)) {
		if (value !== undefined) o2[key] = value
	}
	return o2 as T
}
export function ensureValidValue<T>(value: T, check: (value: any) => boolean, defaultValue: T): T {
	if (check(value)) return value
	return defaultValue
}
export function makeFileNameUrlSafe(fileName: string): string {
	return encodeURIComponent(fileName)
}
