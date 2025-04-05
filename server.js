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

const clients = new Map(); // Store clients: { ws, id, name, state }
const playerStates = new Map(); // Store last known state: { position, rotation, health, name, ... }

console.log(`WebSocket server starting on port ${PORT}...`);

wss.on('connection', (ws) => {
    // 1. Assign Unique ID
    const clientId = uuidv4();
    // Add name placeholder initially
    const clientData = { ws, id: clientId, name: null, state: {} };
    clients.set(clientId, clientData);
    playerStates.set(clientId, {}); // Initialize state
    console.log(`Client connected: ${clientId} (Total: ${clients.size})`);

    // 2. Send ID to new client
    ws.send(JSON.stringify({ type: 'assignId', payload: { id: clientId } }));

    // 3. Send current world state (list of other players) to new client
    const currentState = [];
    playerStates.forEach((state, id) => {
        // Only send if state and name exist
        if (id !== clientId && state.name && Object.keys(state).length > 0) {
             currentState.push({ id, name: state.name, state }); // <<< Send name
        }
    });
    ws.send(JSON.stringify({ type: 'worldState', payload: { players: currentState } }));

    // Don't broadcast join until we have a name (wait for first state update)
    // broadcast({ type: 'playerJoined', payload: { id: clientId, name: null, state: {} } }, ws);

    // 5. Handle Messages from this Client
    ws.on('message', (messageBuffer) => {
        try {
            const message = JSON.parse(messageBuffer.toString());

            switch (message.type) {
                case 'playerStateUpdate':
                    const firstUpdate = !playerStates.get(clientId)?.name; // Check if name was missing before
                    const incomingName = message.payload.name || clientData.name || `Player_${clientId.substring(0,4)}`;

                    // Update state, including name
                    const newState = { ...message.payload, name: incomingName };
                    playerStates.set(clientId, newState);
                    clientData.state = newState;
                    if (!clientData.name) clientData.name = incomingName; // Store name definitively

                    // If this was the first update (where name arrived), broadcast join now
                    if (firstUpdate) {
                         console.log(`Player ${clientId} identified as ${incomingName}`);
                         broadcast({ 
                             type: 'playerJoined', 
                             payload: { id: clientId, name: incomingName, state: newState } // <<< Send name
                         }, ws); // Exclude sender from join message
                    }

                    // Broadcast update (includes name now)
                    broadcast({
                        type: 'playerUpdate',
                        payload: { id: clientId, state: newState } // State includes name
                    }, ws); // Send to everyone except the sender
                    break;

                case 'chatMessage':
                    if (message.payload && message.payload.text) {
                        const text = message.payload.text.substring(0, 100); 
                        
                        // Broadcast including sender's ID (client will use name from player data)
                        broadcast({
                            type: 'chatMessage',
                            payload: { 
                                senderId: clientId, 
                                text: text 
                            }
                        }); // Send to everyone including sender
                    }
                    break;

                default:
                    console.log(`Unhandled message type from ${clientId}: ${message.type}`);
            }
        } catch (error) {
            console.error(`Failed to process message from ${clientId}:`, error);
        }
    });

    // 6. Handle Client Disconnection
    ws.on('close', () => {
        const clientName = clientData.name || clientId;
        console.log(`Client disconnected: ${clientName} (${clientId}) (Remaining: ${clients.size - 1})`);
        clients.delete(clientId);
        playerStates.delete(clientId);
        // Notify others
        broadcast({ type: 'playerLeft', payload: { id: clientId } }); // No need to exclude sender here
    });

    ws.on('error', (error) => {
        console.error(`WebSocket error for ${clientId}:`, error);
        if (clients.has(clientId)) {
            const name = clients.get(clientId).name || clientId;
            clients.delete(clientId);
            playerStates.delete(clientId);
            broadcast({ type: 'playerLeft', payload: { id: clientId } });
        }
    });
});

// Helper function to broadcast messages
function broadcast(message, senderWs = null) { // Allow explicitly passing null senderWs
    const payload = message.payload || {};
    const state = payload.state || {};
    const senderId = payload.id || (senderWs ? [...clients].find(([id, data]) => data.ws === senderWs)?.[0] : payload.senderId);

    // Avoid sending join messages without a name yet
    if (message.type === 'playerJoined' && !payload.name) {
         // console.log("Skipping broadcast of join without name");
         return;
    }
    
    // Ensure state always has name if available (for consistency)
    if (senderId && message.type !== 'playerLeft' && message.type !== 'chatMessage') {
        const senderData = clients.get(senderId);
        if (senderData?.name && !state.name) {
            state.name = senderData.name;
        }
    }

    const messageString = JSON.stringify(message);
    
    clients.forEach((client) => {
        // Determine if this client should receive the message
        let shouldSend = false;
        if (client.ws.readyState === client.ws.OPEN) {
           if (message.type === 'chatMessage' || message.type === 'playerLeft' || message.type === 'playerJoined') {
              // Broadcast chat, leave, join to everyone (even sender for chat)
              shouldSend = true; 
           } else if (message.type === 'playerUpdate' || message.type === 'worldState') {
              // Send updates only to others
              shouldSend = client.ws !== senderWs;
           } else {
              // Default: send to others unless senderWs is null
              shouldSend = !senderWs || client.ws !== senderWs;
           }        
        }

        if (shouldSend) {
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