export namespace bridge {
	
	export class ToolInfo {
	    name: string;
	    description: string;
	
	    static createFrom(source: any = {}) {
	        return new ToolInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.description = source["description"];
	    }
	}

}

export namespace commands {
	
	export class Result {
	    command: string;
	    exit_code: number;
	    output: string;
	
	    static createFrom(source: any = {}) {
	        return new Result(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.command = source["command"];
	        this.exit_code = source["exit_code"];
	        this.output = source["output"];
	    }
	}

}

export namespace domain {
	
	export class ArgumentSpec {
	    name: string;
	    description?: string;
	    required?: boolean;
	    value_hint?: string;
	    suggestions?: string[];
	
	    static createFrom(source: any = {}) {
	        return new ArgumentSpec(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.description = source["description"];
	        this.required = source["required"];
	        this.value_hint = source["value_hint"];
	        this.suggestions = source["suggestions"];
	    }
	}
	export class CommandSpec {
	    name: string;
	    aliases?: string[];
	    description?: string;
	    category?: string;
	    arguments?: ArgumentSpec[];
	    mode: string;
	    dangerous?: boolean;
	
	    static createFrom(source: any = {}) {
	        return new CommandSpec(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.aliases = source["aliases"];
	        this.description = source["description"];
	        this.category = source["category"];
	        this.arguments = this.convertValues(source["arguments"], ArgumentSpec);
	        this.mode = source["mode"];
	        this.dangerous = source["dangerous"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace main {
	
	export class Attachment {
	    name: string;
	    media_type: string;
	    data: string;
	
	    static createFrom(source: any = {}) {
	        return new Attachment(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.media_type = source["media_type"];
	        this.data = source["data"];
	    }
	}
	export class AuthProvider {
	    id: string;
	    label: string;
	    type: string;
	    auth: string;
	    connected: boolean;
	    env_only: boolean;
	    custom: boolean;
	    env_var?: string;
	    base_url?: string;
	    detail?: string;
	    model_count?: number;
	    default_model?: string;
	    key_count?: number;
	    masked_key?: string;
	    key_mode?: string;
	    only_free?: boolean;
	    disabled?: boolean;
	
	    static createFrom(source: any = {}) {
	        return new AuthProvider(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.label = source["label"];
	        this.type = source["type"];
	        this.auth = source["auth"];
	        this.connected = source["connected"];
	        this.env_only = source["env_only"];
	        this.custom = source["custom"];
	        this.env_var = source["env_var"];
	        this.base_url = source["base_url"];
	        this.detail = source["detail"];
	        this.model_count = source["model_count"];
	        this.default_model = source["default_model"];
	        this.key_count = source["key_count"];
	        this.masked_key = source["masked_key"];
	        this.key_mode = source["key_mode"];
	        this.only_free = source["only_free"];
	        this.disabled = source["disabled"];
	    }
	}
	export class ChatMessage {
	    id: string;
	    role: string;
	    content: string;
	    timestamp?: string;
	    done: boolean;
	
	    static createFrom(source: any = {}) {
	        return new ChatMessage(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.role = source["role"];
	        this.content = source["content"];
	        this.timestamp = source["timestamp"];
	        this.done = source["done"];
	    }
	}
	export class ModelUsage {
	    model: string;
	    input: number;
	    output: number;
	    cache_read: number;
	    cache_write: number;
	    cached: number;
	    total: number;
	
	    static createFrom(source: any = {}) {
	        return new ModelUsage(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.model = source["model"];
	        this.input = source["input"];
	        this.output = source["output"];
	        this.cache_read = source["cache_read"];
	        this.cache_write = source["cache_write"];
	        this.cached = source["cached"];
	        this.total = source["total"];
	    }
	}
	export class DailyUsage {
	    date: string;
	    input: number;
	    output: number;
	    cached: number;
	    total: number;
	    models: ModelUsage[];
	
	    static createFrom(source: any = {}) {
	        return new DailyUsage(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.date = source["date"];
	        this.input = source["input"];
	        this.output = source["output"];
	        this.cached = source["cached"];
	        this.total = source["total"];
	        this.models = this.convertValues(source["models"], ModelUsage);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class DesktopConfig {
	    schema_version: number;
	    model?: string;
	    theme: string;
	    font_size: string;
	    permission_profile: string;
	    sandbox: string;
	    show_reasoning: boolean;
	    reasoning_expanded: boolean;
	    max_swarm_concurrency: number;
	    thinking_mode: string;
	    yolo: boolean;
	    rickserve_path?: string;
	    workspace_path?: string;
	    background_mode?: string;
	    background_path?: string;
	    background_transparency?: number;
	
	    static createFrom(source: any = {}) {
	        return new DesktopConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.schema_version = source["schema_version"];
	        this.model = source["model"];
	        this.theme = source["theme"];
	        this.font_size = source["font_size"];
	        this.permission_profile = source["permission_profile"];
	        this.sandbox = source["sandbox"];
	        this.show_reasoning = source["show_reasoning"];
	        this.reasoning_expanded = source["reasoning_expanded"];
	        this.max_swarm_concurrency = source["max_swarm_concurrency"];
	        this.thinking_mode = source["thinking_mode"];
	        this.yolo = source["yolo"];
	        this.rickserve_path = source["rickserve_path"];
	        this.workspace_path = source["workspace_path"];
	        this.background_mode = source["background_mode"];
	        this.background_path = source["background_path"];
	        this.background_transparency = source["background_transparency"];
	    }
	}
	export class Model {
	    id: string;
	    name: string;
	    provider: string;
	    context_window: number;
	    configured: boolean;
	    is_default: boolean;
	    free: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Model(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.provider = source["provider"];
	        this.context_window = source["context_window"];
	        this.configured = source["configured"];
	        this.is_default = source["is_default"];
	        this.free = source["free"];
	    }
	}
	
	export class Provider {
	    name: string;
	    label: string;
	    type: string;
	    models: Model[];
	
	    static createFrom(source: any = {}) {
	        return new Provider(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.label = source["label"];
	        this.type = source["type"];
	        this.models = this.convertValues(source["models"], Model);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class RickStatus {
	    installed: boolean;
	    rick_path: string;
	    rickserve_path: string;
	    rick_version: string;
	    install_dir: string;
	
	    static createFrom(source: any = {}) {
	        return new RickStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.installed = source["installed"];
	        this.rick_path = source["rick_path"];
	        this.rickserve_path = source["rickserve_path"];
	        this.rick_version = source["rick_version"];
	        this.install_dir = source["install_dir"];
	    }
	}
	export class RunOptions {
	    max_turns?: number;
	    permission_profile?: string;
	    sandbox?: string;
	    thinking?: string;
	    yolo?: boolean;
	    agent?: string;
	    cwd?: string;
	    attachments?: Attachment[];
	
	    static createFrom(source: any = {}) {
	        return new RunOptions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.max_turns = source["max_turns"];
	        this.permission_profile = source["permission_profile"];
	        this.sandbox = source["sandbox"];
	        this.thinking = source["thinking"];
	        this.yolo = source["yolo"];
	        this.agent = source["agent"];
	        this.cwd = source["cwd"];
	        this.attachments = this.convertValues(source["attachments"], Attachment);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class RuntimeInfo {
	    version: string;
	    rickserve_path: string;
	    settings_path: string;
	    sessions_path: string;
	    running: boolean;
	
	    static createFrom(source: any = {}) {
	        return new RuntimeInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.version = source["version"];
	        this.rickserve_path = source["rickserve_path"];
	        this.settings_path = source["settings_path"];
	        this.sessions_path = source["sessions_path"];
	        this.running = source["running"];
	    }
	}
	export class TokenUsage {
	    input: number;
	    output: number;
	    cache_read: number;
	    cache_write: number;
	    cached: number;
	    total: number;
	
	    static createFrom(source: any = {}) {
	        return new TokenUsage(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.input = source["input"];
	        this.output = source["output"];
	        this.cache_read = source["cache_read"];
	        this.cache_write = source["cache_write"];
	        this.cached = source["cached"];
	        this.total = source["total"];
	    }
	}
	export class Session {
	    id: string;
	    title: string;
	    cwd: string;
	    model: string;
	    messages: number;
	    created: string;
	    updated: string;
	    category?: string;
	    favorite?: boolean;
	    usage: TokenUsage;
	
	    static createFrom(source: any = {}) {
	        return new Session(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.title = source["title"];
	        this.cwd = source["cwd"];
	        this.model = source["model"];
	        this.messages = source["messages"];
	        this.created = source["created"];
	        this.updated = source["updated"];
	        this.category = source["category"];
	        this.favorite = source["favorite"];
	        this.usage = this.convertValues(source["usage"], TokenUsage);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class UpdateInfo {
	    current_version: string;
	    latest_version: string;
	    update_available: boolean;
	    asset_name: string;
	    download_url: string;
	    release_notes?: string;
	    checked_at: string;
	    error?: string;
	
	    static createFrom(source: any = {}) {
	        return new UpdateInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.current_version = source["current_version"];
	        this.latest_version = source["latest_version"];
	        this.update_available = source["update_available"];
	        this.asset_name = source["asset_name"];
	        this.download_url = source["download_url"];
	        this.release_notes = source["release_notes"];
	        this.checked_at = source["checked_at"];
	        this.error = source["error"];
	    }
	}
	export class UsageStats {
	    session_id?: string;
	    model?: string;
	    session: TokenUsage;
	    total: TokenUsage;
	    context_used?: number;
	    context_limit?: number;
	    context_known: boolean;
	
	    static createFrom(source: any = {}) {
	        return new UsageStats(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.session_id = source["session_id"];
	        this.model = source["model"];
	        this.session = this.convertValues(source["session"], TokenUsage);
	        this.total = this.convertValues(source["total"], TokenUsage);
	        this.context_used = source["context_used"];
	        this.context_limit = source["context_limit"];
	        this.context_known = source["context_known"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

