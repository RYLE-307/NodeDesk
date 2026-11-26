/** Build a bounded, manually downloaded diagnostic report. No network or storage side effects. */
export type ReportSource={
  host:string;
  port:number;
  tcp:{addresses:string[];tcpReachable:boolean;elapsedMs:number}|null;
  ping:{reachable:boolean;elapsedMs:number;output:string}|null;
  trace:{elapsedMs:number;output:string}|null;
  ports:{addresses:string[];results:{port:number;reachable:boolean}[];elapsedMs:number}|null;
};
export type ReportOptions={createdAt:string;includeSensitive:boolean};

export function createNetworkReport(source:ReportSource,options:ReportOptions){
  const full=options.includeSensitive===true;
  return {
    version:2,
    createdAt:options.createdAt,
    redacted:!full,
    target:full?{host:source.host.trim()}:null,
    tcp:source.tcp?{
      port:source.port,
      tcpReachable:source.tcp.tcpReachable,
      elapsedMs:source.tcp.elapsedMs,
      ...(full?{addresses:source.tcp.addresses.slice(0,16)}:{})
    }:null,
    ping:source.ping?{
      reachable:source.ping.reachable,
      elapsedMs:source.ping.elapsedMs,
      ...(full?{output:source.ping.output}:{})
    }:null,
    trace:source.trace?{
      elapsedMs:source.trace.elapsedMs,
      ...(full?{output:source.trace.output}:{})
    }:null,
    ports:source.ports?{
      elapsedMs:source.ports.elapsedMs,
      results:source.ports.results.slice(0,12).map(item=>({port:item.port,reachable:item.reachable})),
      ...(full?{addresses:source.ports.addresses.slice(0,16)}:{})
    }:null
  };
}
