/** Reviewed OpenAPI 3.1 descriptions. Only services defined here are callable.
 * Operation identity follows OAS: a description's servers + paths + HTTP
 * method, with operationId as the stable application-facing identifier.
 * No caller-supplied URL is ever resolved as an arbitrary proxy destination.
 */
export type ServiceOperation = {
  serviceKey: string;
  base: string;
  path: string;
  method: "GET" | "POST";
  parameters: readonly string[];
  pathParameters: readonly string[];
  maxRequestBytes?: number;
  timeoutMs?: number;
};
type Parameter = {
  name: string;
  in: "query" | "path";
  required?: boolean;
  schema: { type: "string" };
};
type OpenApiOperation = {
  operationId: string;
  parameters?: Parameter[];
  requestBody?: {required: boolean; content: {"application/json": {schema: {type: "object"}}}};
  responses: Record<string, {description: string}>;
  security?: Array<Record<string, never[]>>;
  "x-maestro-max-request-bytes"?: number;
  "x-maestro-timeout-ms"?: number;
};
type OpenApiDocument = {
  openapi: "3.1.0";
  info: {title: string;version: string};
  servers: Array<{url: string}>;
  components?: {securitySchemes: Record<string, {type: "http";scheme: "bearer";bearerFormat?: string}>};
  paths: Record<string, {get?: OpenApiOperation;post?:OpenApiOperation}>;
};
const param = (name:string,where:"query"|"path"="query"):Parameter=>({name,in:where,
  ...(where==="path"?{required:true}:{}),schema:{type:"string"}});
const get = (operationId:string, query:string[]=[], path:string[]=[]):{get:OpenApiOperation}=>({
  get:{operationId,parameters:[...path.map(name=>param(name,"path")),...query.map(name=>param(name))],
    responses:{"200":{description:"Successful JSON response"}}}
});
const specifications: Record<string, OpenApiDocument> = {
  iteracompute: {
    openapi:"3.1.0",info:{title:"IteraCompute Chat Completions",version:"1"},
    servers:[{url:"https://api.iteracompute.com"}],
    components:{securitySchemes:{bearerAuth:{type:"http",scheme:"bearer",bearerFormat:"API key"}}},
    paths:{"/v1/chat/completions":{post:{operationId:"createChatCompletion",
      requestBody:{required:true,content:{"application/json":{schema:{type:"object"}}}},
      responses:{"200":{description:"Chat completion JSON or streamed SSE"}},
      security:[{bearerAuth:[]}],
      "x-maestro-max-request-bytes":600000,
      "x-maestro-timeout-ms":180000,
    }}},
  },
  commons:{openapi:"3.1.0",info:{title:"Wikimedia Commons API",version:"1"},
    servers:[{url:"https://commons.wikimedia.org"}],
    paths:{"/w/api.php":get("searchImages",["action","format","generator","gsrnamespace","gsrsearch","gsrlimit","prop","iiprop","iiurlwidth"])}},
  rank:{openapi:"3.1.0",info:{title:"Rank.to public ranking API",version:"1"},
    servers:[{url:"https://rank.to"}],paths:{"/api/":get("rankDomain",["d","n"])}},
  prefixcc:{openapi:"3.1.0",info:{title:"prefix.cc JSON-LD Context",version:"1"},
    servers:[{url:"https://prefix.cc"}],paths:{"/context.jsonld":get("getPrefixes")}},
  zazuko:{openapi:"3.1.0",info:{title:"Zazuko Prefix Registry",version:"1"},
    servers:[{url:"https://prefix.zazuko.com"}],paths:{"/api/v1/prefixes":get("getPrefixes")}},
  openlibrary:{openapi:"3.1.0",info:{title:"Open Library Read-only REST API",version:"1"},
    servers:[{url:"https://openlibrary.org"}],
    paths:{
      "/search.json":get("find",["title","author","limit","fields"]),
      "/works/{workId}.json":get("details",[],["workId"]),
      "/works/{workId}/editions.json":get("editions",["limit"],["workId"]),
      "/works/{workId}/ratings.json":get("ratings",[],["workId"]),
      "/works/{workId}/bookshelves.json":get("bookshelves",[],["workId"]),
      "/authors/{authorId}.json":get("author",[],["authorId"]),
      "/authors/{authorId}/works.json":get("authorWorks",["limit"],["authorId"]),
      "/isbn/{isbn}.json":get("isbn",[],["isbn"]),
      "/subjects/{subject}.json":get("subject",["limit"],["subject"]),
    }
  },
};

/** Resolve a registered OAS description by name, or by its literal servers.url.
 * The URL alternative never authorizes a destination absent from the registry. */
export function resolveOpenApiOperation(service:string,operationId:string):ServiceOperation|null{
  const found=Object.entries(specifications).find(([name,doc])=>
    (name===service||doc.servers.some(s=>s.url.replace(/\/+$/,"")===service.replace(/\/+$/,""))) &&
    Object.values(doc.paths).some(path=>path.get?.operationId===operationId||path.post?.operationId===operationId));
  if(!found)return null;
  const [serviceKey,spec]=found;
  for(const [path,item] of Object.entries(spec.paths)){
    for(const method of ["GET","POST"] as const){
      const operation=method==="GET"?item.get:item.post;
      if(operation?.operationId!==operationId)continue;
      return {serviceKey,base:spec.servers[0].url,path,method,
        parameters:(operation.parameters??[]).map(x=>x.name),
        pathParameters:(operation.parameters??[]).filter(x=>x.in==="path").map(x=>x.name),
        maxRequestBytes:operation["x-maestro-max-request-bytes"],
        timeoutMs:operation["x-maestro-timeout-ms"]};
    }
  }
  return null;
}

/** Match a graph-described Record service target to the accepted OAS operation.
 * The target URL is never sent to /service as an arbitrary URL. */
export function matchRegisteredOpenApiGet(value:string):{service:string;operationId:string;parameters:Record<string,string>}|null{
  let target:URL;
  try{target=new URL(value);}catch{return null;}
  if(target.protocol!=="https:"||target.username||target.password||target.hash)return null;
  for(const [service,spec] of Object.entries(specifications)){
    if(!spec.servers.some(server=>new URL(server.url).origin===target.origin))continue;
    for(const [path,item] of Object.entries(spec.paths)){
      if(!item.get)continue;
      const placeholders=[...path.matchAll(/\{([A-Za-z][A-Za-z0-9_-]*)\}/g)];
      const pattern="^"+path.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")
        .replace(/\\\{([A-Za-z][A-Za-z0-9_-]*)\\\}/g,"([^/]+)")+"$";
      const matched=new RegExp(pattern).exec(target.pathname);
      if(!matched)continue;
      const parameters:Record<string,string>={};
      for(let index=0;index<placeholders.length;index++){
        try{parameters[placeholders[index][1]]=decodeURIComponent(matched[index+1]);}catch{return null;}
      }
      for(const [name,data] of target.searchParams){
        if(Object.hasOwn(parameters,name)||!item.get.parameters?.some(param=>param.name===name&&param.in==="query"))return null;
        parameters[name]=data;
      }
      return {service,operationId:item.get.operationId,parameters};
    }
  }
  return null;
}
