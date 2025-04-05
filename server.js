// server.js
import { WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import http from 'http';

const PORT = process.env.PORT || 8080; // Use port from environment or default to 8080

// Use HTTP server for compatibility with deployment platforms
const server = http.createServer((req, res) => {
    // Basic response for HTTP requests (e.g., health checks)
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('WebSocket Server is running');
});

const wss = new WebSocketServer({ server }); // Attach WebSocket server to HTTP server

const clients = new Map(); // Store clients: { ws, id, state }
const playerStates = new Map(); // Store last known state: { position, rotation, health, ... }

console.log(`WebSocket server starting on port ${PORT}...`);

wss.on('connection', (ws) => {
    // 1. Assign Unique ID
    const clientId = uuidv4();
    const clientData = { ws, id: clientId, state: {} };
    clients.set(clientId, clientData);
    playerStates.set(clientId, {}); // Initialize state
    console.log(`Client connected: ${clientId} (Total: ${clients.size})`);

    // 2. Send ID to new client
    ws.send(JSON.stringify({ type: 'assignId', payload: { id: clientId } }));

    // 3. Send current world state (list of other players) to new client
    const currentState = [];
    playerStates.forEach((state, id) => {
        // Send state only if it's not empty (player has sent at least one update)
        if (id !== clientId && Object.keys(state).length > 0) {
             currentState.push({ id, state });
        }
    });
    ws.send(JSON.stringify({ type: 'worldState', payload: { players: currentState } }));

    // 4. Notify others about the new player
    broadcast({ type: 'playerJoined', payload: { id: clientId, state: {} } }, ws); // Send empty state initially

    // 5. Handle Messages from this Client
    ws.on('message', (messageBuffer) => {
        try {
            const message = JSON.parse(messageBuffer.toString());
            // console.log(`Received from ${clientId}:`, message.type);

            switch (message.type) {
                case 'playerStateUpdate':
                    // Update server's record of this player's state
                    playerStates.set(clientId, message.payload);
                    clientData.state = message.payload; // Also update clientData if needed elsewhere

                    // Broadcast this update to others
                    broadcast({
                        type: 'playerUpdate',
                        payload: { id: clientId, state: message.payload }
                    }, ws); // Send to everyone except the sender
                    break;

                case 'chatMessage':
                    if (message.payload && message.payload.text) {
                        // Basic validation/sanitization on server side too if needed
                        const text = message.payload.text.substring(0, 100); // Enforce max length
                        
                        // Broadcast the message including the sender's ID
                        broadcast({
                            type: 'chatMessage',
                            payload: { 
                                senderId: clientId, 
                                text: text 
                            }
                        }); // Send to everyone (including sender for confirmation if desired, or exclude sender)
                    }
                    break;

                // Add other message types if needed (chat, actions, etc.)

                default:
                    console.log(`Unhandled message type from ${clientId}: ${message.type}`);
            }
        } catch (error) {
            console.error(`Failed to process message from ${clientId}:`, error);
        }
    });

    // 6. Handle Client Disconnection
    ws.on('close', () => {
        console.log(`Client disconnected: ${clientId} (Remaining: ${clients.size - 1})`);
        clients.delete(clientId);
        playerStates.delete(clientId);
        // Notify others
        broadcast({ type: 'playerLeft', payload: { id: clientId } }, ws);
    });

    ws.on('error', (error) => {
        console.error(`WebSocket error for ${clientId}:`, error);
        // Ensure cleanup happens even on error
        if (clients.has(clientId)) {
            clients.delete(clientId);
            playerStates.delete(clientId);
            broadcast({ type: 'playerLeft', payload: { id: clientId } }, ws);
        }
    });
});

// Helper function to broadcast messages
function broadcast(message, senderWs) {
    // Avoid sending if message payload is empty (can happen initially)
    if (message.payload && message.payload.state && Object.keys(message.payload.state).length === 0 && message.type !== 'playerLeft') {
        // console.log("Skipping broadcast of empty state for", message.type, message.payload.id);
        return;
    }
    
    const messageString = JSON.stringify(message);
    clients.forEach((client) => {
        if (client.ws !== senderWs && client.ws.readyState === client.ws.OPEN) {
            try {
                 client.ws.send(messageString);
            } catch (error) {
                 console.error(`Failed to send message to client ${client.id}:`, error);
            }
        }
    });
}

// Start listening
server.listen(PORT, () => {
    console.log(`HTTP server listening on port ${PORT}`);
}); 