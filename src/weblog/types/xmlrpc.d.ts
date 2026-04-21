declare module 'xmlrpc' {
  export function parseMethodCall(xml: string, callback: (error: any, methodName: string, params: any[]) => void): void;
  export function serializeMethodResponse(response: any): string;
  export function serializeFault(fault: { faultCode: number; faultString: string }): string;
}
