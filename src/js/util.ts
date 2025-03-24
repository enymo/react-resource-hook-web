import { DeepPartial } from "ts-essentials";

export function filter<T extends object>(input: T): T {
    return Object.fromEntries(Object.entries(input).filter(([,value]) => value !== undefined)) as T;
}

export const identity = (input: any) => input

function isAtomic(input: any, reactNative: boolean) {
    return (
        isFile(input, reactNative)
        || input === null
        || typeof input !== "object"
    )
}

function isFile(input: any, reactNative: boolean) {
    return reactNative ? "uri" in input && "name" in input && "type" in input : input instanceof File;
}

export function objectNeedsFormDataConversion(input: any, reactNative: boolean): boolean {
    if (isAtomic(input, reactNative)) {
        return isFile(input, reactNative);
    }
    else {
        for (const value of Array.isArray(input) ? input : Object.values(input)) {
            if (objectNeedsFormDataConversion(value, reactNative)) {
                return true;
            }
        }
        return false;
    }
}

function objectToFormDataRecursive(input: any, reactNative: boolean, fd: FormData, path: string) {
    if (isAtomic(input, reactNative)) {
        switch (input) {
            case undefined:
                break;
            case null:
                fd.append(path, "");
                break;
            case true:
                fd.append(path, "1");
                break;
            case false:
                fd.append(path, "0");
                break;
            default:
                fd.append(path, input);
        }
    }
    else {
        for (const [key, value] of Array.isArray(input) ? input.entries() : Object.entries(input)) {
            objectToFormDataRecursive(value, reactNative, fd, `${path}[${key}]`);
        }
    }
}

export function objectToFormData(input: object, reactNative: boolean) {
    const fd = new FormData();
    for (const [key, value] of Object.entries(input)) {
        objectToFormDataRecursive(value, reactNative, fd, key);
    }
    return fd;
}

function isSubsetRecursive(a: any, b: any) {
    if (isAtomic(a, false)) {
        return a === b;
    }
    else {
        for (const [key, value] of Array.isArray(a) ? a.entries() : Object.entries(a)) {
            const result = isSubsetRecursive(value, b[key]);
            if (!result) {
                return false;
            }
        }
        return true;
    }
}

function pruneUnchangedRecursive(input: any, comparison: any, reactNative: boolean, target: any, ignoreKeys: string[] = []) {
    for (const [key, value] of Object.entries(input)) {
        if (isAtomic(value, reactNative) || Array.isArray(value)) {
            if (ignoreKeys.includes(key) || !isSubsetRecursive(value, comparison[key])) {
                target[key] = value;
            }
        }
        else {
            target[key] = {};
            pruneUnchangedRecursive(value, comparison[key], reactNative, target[key]);
        }
    }
}

export function pruneUnchanged<T>(input: object, comparison: object, reactNative: boolean, ignoreKeys: string[] = []): DeepPartial<T> {
    const target = {}
    pruneUnchangedRecursive(input, comparison, reactNative, target, ignoreKeys);
    return target as DeepPartial<T>;
}

export function randomString(length: number) {
    const chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    return Array<void>(length).fill().map(() => chars[Math.floor(Math.random() * chars.length)]).join("");
}

export function dateTransformer(input: any) {
    return Object.fromEntries(Object.entries(input).map(([key, value]) => [
        key,
        typeof value === "string" && /^\d{4}-\d{2}-\d{2}T(?:\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|(?:\+|-)\d{2}:\d{2})?)?$/.test(value) 
            ? new Date(value) 
            : value
    ]));
}

const pad = (n: number) => `${Math.floor(Math.abs(n))}`.padStart(2, '0');

function toISOStringWithTimezone(date: Date) {
    const tzOffset = -date.getTimezoneOffset();
    const diff = tzOffset >= 0 ? '+' : '-';
    return date.getFullYear() +
        '-' + pad(date.getMonth() + 1) +
        '-' + pad(date.getDate()) +
        'T' + pad(date.getHours()) +
        ':' + pad(date.getMinutes()) +
        ':' + pad(date.getSeconds()) +
        diff + pad(tzOffset / 60) +
        ':' + pad(tzOffset % 60);
};

export function inverseDateTransformer(input: any) {
    return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, value instanceof Date ? toISOStringWithTimezone(value) : value]));
}

export function conditionalApply(input: any, func: Function, apply: boolean) {
    return apply ? func(input) : input;
}

export function unwrap(input: object) {
    if ("data" in input && typeof input.data === "object" && input.data !== null) {
        return {
            data: input.data as any,
            meta: "meta" in input ? input.meta : null as any
        }
    }
    else {
        return {
            data: input,
            meta: null
        }
    }
}