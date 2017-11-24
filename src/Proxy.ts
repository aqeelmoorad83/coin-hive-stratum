import * as WebSocket from "ws";
import * as url from "url";
import * as defaults from "../config/defaults";
import Connection from "./Connection";
import Miner from "./Miner";
import Donation, { Options as DonationOptions } from "./Donation";
import { Dictionary, Stats, WebSocketQuery } from "src/types";
import { Request } from "_debugger";
import { ServerRequest } from "http";

export type Options = {
  host: string;
  port: number;
  pass: string;
  ssl: false;
  address: string | null;
  user: string | null;
  diff: number | null;
  dynamicPool: boolean;
  path: string | null;
  maxMinersPerConnection: number;
  donations: DonationOptions[];
};

class Proxy {
  host: string = null;
  port: number = null;
  pass: string = null;
  path: string = null;
  ssl: boolean = null;
  address: string = null;
  user: string = null;
  diff: number = null;
  dynamicPool: boolean = false;
  maxMinersPerConnection: number = 100;
  donations: DonationOptions[] = [];
  connections: Dictionary<Connection[]> = {};
  wss: WebSocket.Server = null;

  constructor(constructorOptions: Options = defaults) {
    let options = Object.assign({}, defaults, constructorOptions) as Options;
    this.host = options.host;
    this.port = options.port;
    this.pass = options.pass;
    this.path = options.path;
    this.ssl = options.ssl;
    this.address = options.address;
    this.user = options.user;
    this.diff = options.diff;
    this.dynamicPool = options.dynamicPool;
    this.maxMinersPerConnection = options.maxMinersPerConnection;
    this.donations = options.donations;
    this.connections = {};
    this.wss = null;
  }

  listen(wssOptions: WebSocket.ServerOptions): void {
    // this is in case the user passes only a port, like: proxy.listen(8892);
    if (wssOptions !== Object(wssOptions)) {
      wssOptions = { port: +wssOptions };
    }
    if (this.path) {
      wssOptions.path = this.path;
    }
    this.wss = new WebSocket.Server(wssOptions);
    console.log("websocket server created");
    if (wssOptions.port) {
      console.log("listening on port", wssOptions.port);
    }
    if (wssOptions.server) {
      console.log("using custom server");
    }
    this.wss.on("connection", (ws: WebSocket, req: ServerRequest) => {
      console.log(`new websocket connection`);
      const params = url.parse(req.url, true).query as WebSocketQuery;
      let host = this.host;
      let port = this.port;
      let pass = this.pass;
      if (params.pool && this.dynamicPool) {
        const split = params.pool.split(":");
        host = split[0] || this.host;
        port = Number(split[1]) || this.port;
        pass = split[2] || this.pass;
      }
      const donations = this.donations.map(
        donation =>
          new Donation({
            address: donation.address,
            host: donation.host,
            port: donation.port,
            pass: donation.pass,
            percentage: donation.percentage,
            connection: this.getConnection(donation.host, donation.port)
          })
      );
      const connection = this.getConnection(host, port);
      const miner = new Miner({
        connection,
        ws,
        address: this.address,
        user: this.user,
        diff: this.diff,
        pass,
        donations
      });
      miner.connect();
    });
  }

  getConnection(host: string, port: number): Connection {
    const connectionId = `${host}:${port}`;
    if (!this.connections[connectionId]) {
      this.connections[connectionId] = [];
    }
    const connections = this.connections[connectionId];
    let connection = connections.find(connection => this.isAvailable(connection));
    if (!connection) {
      connection = new Connection({ host, port, ssl: this.ssl });
      connection.connect();
      connection.on("close", () => {
        console.log(`connection closed (${connectionId})`);
      });
      connection.on("error", error => {
        console.log(`connection error (${connectionId}):`, error.message);
      });
    }
    connections.push(connection);
    return connection;
  }

  isAvailable(connection: Connection): boolean {
    return connection.online && connection.miners.length < this.maxMinersPerConnection;
  }

  getStats(): Stats {
    return Object.keys(this.connections).reduce(
      (stats, key) => ({
        miners:
          stats.miners + this.connections[key].reduce((miners, connection) => miners + connection.miners.length, 0),
        connections: stats.connections + this.connections[key].length
      }),
      {
        miners: 0,
        connections: 0
      }
    );
  }
}

export default Proxy;