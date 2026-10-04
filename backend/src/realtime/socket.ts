import type { FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import type { WebSocket } from "ws";

const clients = new Set<WebSocket>();

export async function registerRealtime(app: FastifyInstance) {
  await app.register(websocket);

  app.get("/ws", { websocket: true }, (socket) => {
    clients.add(socket);

    socket.send(JSON.stringify({
      type: "connection.ready",
      payload: { service: "kumari-bites-backend" }
    }));

    socket.on("close", () => clients.delete(socket));
  });
}

export function broadcast(event: unknown) {
  const message = JSON.stringify(event);

  for (const client of clients) {
    if (client.readyState === client.OPEN) {
      client.send(message);
    }
  }
}
