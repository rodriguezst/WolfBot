import * as utils from "@ekliptor/apputils";
import {PushApiConnectionType} from "../AbstractExchange";
const logger = utils.logger
    , nconf = utils.nconf;
import * as WebSocket from "ws";
import * as autobahn from "autobahn";
import * as EventEmitter from 'events';
import {Currency, Ticker} from "@ekliptor/bit-models";
import * as path from "path";

export type ExchangeFeed = "BitmexMarketData";
export type MarketEvent = "liquidation";

/**
 * Class to fetch exchange data impacting all crypto currencies.
 * Other than AbstractExchange implementations this class works with API keys.
 */
export abstract class AbstractMarketData extends EventEmitter {
    protected className: string;
    protected static instances = new Map<string, AbstractMarketData>(); // (className, instance)

    protected currencyPairs: Currency.CurrencyPair[] = [];
    protected exchangeLabel: Currency.Exchange;

    protected websocketTimeoutTimerID: NodeJS.Timer = null;
    //protected websocketPingTimerID: NodeJS.Timer = null;
    protected webSocketTimeoutMs: number = nconf.get('serverConfig:websocketTimeoutMs'); // set to 0 to disable it
    protected websocketCleanupFunction: () => boolean = null;
    protected static pushApiConnections = new Map<string, autobahn.Connection | WebSocket>(); // (className, instance)
    protected pushApiConnectionType: PushApiConnectionType = PushApiConnectionType.WEBSOCKET;

    constructor() {
        super()
        this.className = this.constructor.name;
    }

    /**
     * Use this instead of the constructor when loading exchange feeds in strategy to avoid opening duplicate websocket connections.
     * @param className
     * @param options
     */
    public static getInstance(className: string, options: any = undefined): AbstractMarketData {
        let instance = AbstractMarketData.instances.get(className);
        if (instance === undefined) {
            let modulePath = path.join(__dirname, className);
            instance = AbstractMarketData.loadModule(modulePath, options);
            AbstractMarketData.instances.set(className, instance);
        }
        return instance;
    }

    public subscribe(currencyPairs: Currency.CurrencyPair[]) {
        if (this.isSubscribed() === true) {
            logger.error("Subscribe can only be called once in %s. Subscribed pairs %s, new %s", this.className, this.currencyPairs.toString(), currencyPairs.toString());
            return; // TODO improve this? the issue is that we would have to check before emitting which listener is interested in this currency
        }
        this.currencyPairs = currencyPairs;
        this.openConnection();
    }

    public isSubscribed() {
        return this.currencyPairs.length !== 0;
    }

    public getCurrencyPairs() {
        return this.currencyPairs;
    }

    public emit(event: MarketEvent, ...args: any[]): boolean {
        return super.emit(event, ...args);
    }

    public on(event: MarketEvent, listener: (...args: any[]) => void) {
        return super.on(event, listener);
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    protected closeConnection(reason: string) {
        let socket = AbstractMarketData.pushApiConnections.get(this.className);
        try {
            if (!socket)
                logger.error("No socket available to close WebSocket connection to %s", this.className)
            else {
                if (this.pushApiConnectionType === PushApiConnectionType.API_WEBSOCKET)
                    this.closeApiWebsocketConnection();
                if (socket instanceof WebSocket)
                    socket.close();
                //else if (socket instanceof autobahn.Connection)
                    //socket.close();
                else if (typeof socket.close === "function")
                    socket.close(); // bitfinex and other APIs // TODO already done in BF class on error. but shouldn't matter?
                else
                    logger.error("Unanble to close unknown WebSocket connection from %s", this.className)
                if (socket instanceof EventEmitter/*typeof socket.removeAllListeners === "function"*/)
                    socket.removeAllListeners()
            }
            if (typeof this.websocketCleanupFunction === "function") {
                if (this.websocketCleanupFunction() === false)
                    logger.error("Error in %s websocket cleanup", this.className)
            }
        }
        catch (err) {
            logger.error("Error closing timed out WebSocket connection", err);
        }
        this.onConnectionClose(reason);
    }

    protected resetWebsocketTimeout() {
        if (this.webSocketTimeoutMs === 0)
            return;
        clearTimeout(this.websocketTimeoutTimerID);
        this.websocketTimeoutTimerID = setTimeout(() => {
            this.closeConnection("Connection timed out");
        }, this.webSocketTimeoutMs);
    }

    protected onConnectionClose(reason: string): void {
        logger.warn("Websocket connection to %s closed: Reason: %s", this.className, reason);
        clearTimeout(this.websocketTimeoutTimerID);
        //clearTimeout(this.websocketPingTimerID);
        setTimeout(this.openConnection.bind(this), 2500);
    }

    protected openConnection(): void {
        let connection = this.createWebsocketConnection();
        AbstractMarketData.pushApiConnections.set(this.className, connection);
    }

    protected createWebsocketConnection(): WebSocket {
        // overwrite this in the subclass and return the connection
        return null;
    }

    protected closeApiWebsocketConnection() {
        // overwrite this when using PushApiConnectionType.API_WEBSOCKET
    }

    protected static loadModule(modulePath: string, options: any = undefined) {
        try {
            let ModuleClass = require(modulePath)
            if (ModuleClass.default)
                ModuleClass = ModuleClass.default; // fix for typescript default exports
            let instance = new ModuleClass(options)
            return instance
        }
        catch (e) { // e.code === 'MODULE_NOT_FOUND'
            logger.error('failed to load module: ' + modulePath, e)
            return null
        }
    }
}

// force loading dynamic imports for TypeScript
import "./BitmexMarketData";