import { createRequiredContext } from "@enymo/react-better-context";
import type { Params, ResourceBackendAdapter } from "@enymo/react-resource-hook";
import useSocket from "@enymo/react-socket-hook";
import { requireNotNull } from "@enymo/ts-nullsafe";
import { AxiosError, AxiosInstance, AxiosRequestConfig } from "axios";
import pluralize from "pluralize";
import { useMemo } from "react";
import { RouteFunction } from "./types";
import { conditionalApply, dateTransformer, filter, identity, inverseDateTransformer, objectNeedsFormDataConversion, objectToFormData } from "./util";

export type { RouteFunction };

const [WebResourceProvider, useContext] = createRequiredContext<{
    axios: AxiosInstance,
    routeFunction: RouteFunction
}>("WebResourceProvider must be present in component tree");

export { WebResourceProvider };
export default function createWebResourceAdapter({
    reactNative = false,
    paramNameCallback,
    eventNameCallback
}: {
    reactNative?: boolean,
    paramNameCallback?: (resource: string) => string,
    eventNameCallback?: (resource: string, params?: Params) => string
}): ResourceBackendAdapter<{
    paramName?: string,
    socketEvent?: string,
    transformer?: (item: any) => Promise<any> | any,
    inverseTransformer?: (item: any) => Promise<any> | any,
    transformDates?: boolean
}, {
    useFormData?: boolean
}, AxiosRequestConfig, AxiosError> {
    return (resource, {
        paramName: paramNameOverride,
        socketEvent: eventOverride,
        transformer: baseTransformer = identity,
        inverseTransformer: baseInverseTransformer = identity,
        transformDates = false
    }) => {
        const transformer = transformDates ? async (item: any) => dateTransformer(await baseTransformer(item)) : baseTransformer;
        const inverseTransformer = transformDates ? async (item: any) => inverseDateTransformer(await baseInverseTransformer(item)) : baseInverseTransformer;

        return {
            actionHook: ({
                useFormData
            }, params) => {
                const {axios, routeFunction} = useContext();
                const paramName = useMemo(() => paramNameOverride ?? (resource && (paramNameCallback?.(resource) ?? pluralize.singular(requireNotNull(resource.split(".").pop())).replace(/-/g, "_"))), [paramNameOverride, resource]);
    
                return useMemo(() => ({
                    async store(data, config) {
                        const body = conditionalApply(await inverseTransformer(data), inverseDateTransformer, transformDates);
                        return transformer((await axios.post(routeFunction(`${resource}.store`, params), (useFormData || objectNeedsFormDataConversion(body, reactNative)) ? objectToFormData(body, reactNative) : body, useFormData ? {
                            ...config,
                            headers: {
                                ...config?.headers,
                                "content-type": "multipart/form-data"
                            },
                        } : config)).data)
                    },
                    async batchStore(data, config) {
                        const body = {
                            _batch: await Promise.all(data.map(async resource => filter(await inverseTransformer(resource))))
                        };
                        return Promise.all((await axios.post(routeFunction(`${resource}.batch.store`, params), (useFormData || objectNeedsFormDataConversion(body, reactNative)) ? objectToFormData(body, reactNative) : body, useFormData ? {
                            ...config,
                            headers: {
                                ...config?.headers,
                                "content-type": "multipart/form-data"
                            }
                        } : config)).data.map(transformer));
                    },
                    async update(id, data, config) {
                        const body = filter(await inverseTransformer(data));
                        const route = routeFunction(`${resource}.update`, {
                            [paramName]: id,
                            ...params
                        });
                        return transformer((await ((useFormData || objectNeedsFormDataConversion(body, reactNative)) ? axios.post(route, objectToFormData({
                            ...body,
                            _method: "put"
                        }, reactNative), {
                            ...config,
                            headers: {
                                ...config?.headers,
                                "content-type": "multipart/form-data"
                            }
                        }) : axios.put(route, body, config))).data)
                    },
                    async batchUpdate(data, config) {
                        const body = {
                            _batch: await Promise.all(data.map(async resource => filter(await inverseTransformer(resource))))
                        };
                        const route = routeFunction(`${resource}.batch.update`, params);
                        return Promise.all((await ((useFormData || objectNeedsFormDataConversion(body, reactNative)) ? axios.post(route, objectToFormData({
                            ...body,
                            _method: "put"
                        }, reactNative), {
                            ...config,
                            headers: {
                                ...config?.headers,
                                "content-type": "multipart/form-data"
                            }
                        }) : axios.put(route, body, config))).data.map(inverseTransformer)); 
                    },
                    async destroy(id, config) {
                        await axios.delete(routeFunction(`${resource}.destroy`, {
                            [paramName]: id,
                            ...params
                        }), config);
                    },
                    async batchDestroy(ids, config) {
                        await axios.delete(routeFunction(`${resource}.batch.destroy`, {
                            ids,
                            ...params
                        }), config);
                    },
                    async query(action, data, params, config) {
                        const response = await axios.post(routeFunction(`${resource}.${action}`, params), data, config);
                        return {
                            data: response.data,
                            destroy: response.headers["x-resource-destroy"]?.split(",").map((id: string) => {
                                const [,type,value] = requireNotNull(id.match(/(i|s):(\d)+/), "Unable to parse x-resource-destroy header");
                                switch (type) {
                                    case "i":
                                        return Number(value);
                                    case "s":
                                        return value;
                                    default:
                                        throw new Error("Unable to parse x-resource-destroy header");
                                }
                            }) ?? [],
                            update: response.headers["x-resource-update"] ?? "merge"
                        }
                    },
                    async refresh(id, config) {
                        try {
                            const response = (await axios.get(id !== undefined ? routeFunction(`${resource}.show`, {
                                [paramName]: id,
                                ...params
                            }) : routeFunction(`${resource}.index`, params), config)).data;
                            if ("data" in response) {
                                const {data, extra} = response;
                                return {
                                    data,
                                    extra,
                                    error: null
                                }
                            }
                            else {
                                return {
                                    data: response,
                                    extra: null as any,
                                    error: null
                                }
                            }
                        }
                        catch (e) {
                            if (e instanceof AxiosError) {
                                return {
                                    data: [],
                                    extra: null as any,
                                    error: e
                                }
                            }
                            else {
                                throw e;
                            }
                        }
                    }
                }), [useFormData, params])
            },
            eventHook: (params, event, handler, dependencies) => {
                const eventBase = useMemo(() => eventOverride ?? eventNameCallback?.(resource, params) ?? resource?.split(".").map(part => {
                    const singular = pluralize.singular(part).replaceAll("-", "_");
                    return (params && singular in params) ? `${part}.${params[singular]}` : part;
                }).join(".") ?? null, [params]);
                useSocket(handler ? `${eventBase}.${event}` : null, handler ?? (() => {}), dependencies);
            }
        }
    }
}