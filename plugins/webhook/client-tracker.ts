// WebRTC Client Tracker - Parse logs for connection info
// Tracks which cameras specific IP addresses are viewing

interface ClientConnection {
    ip: string;
    camera: string;
    timestamp: string;
    connectionType: string;
    userAgent?: string;
}

class WebRTCClientTracker {
    
    /**
     * Parse recent log entries for client connections
     */
    parseRecentConnections(logPath: string = '/Users/richard/node/scrypted/plugins/webhook/plugin.log'): ClientConnection[] {
        try {
            // Read the log file
            const fs = globalThis.require('fs');
            const logContent = fs.readFileSync(logPath, 'utf8');
            
            return this.extractConnections(logContent);
        } catch (e) {
            console.error('Error reading log file:', e);
            return [];
        }
    }
    
    /**
     * Extract connection info from log content
     */
    extractConnections(logContent: string): ClientConnection[] {
        const connections: ClientConnection[] = [];
        const lines = logContent.split('\n');
        
        let currentTimestamp = '';
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            // Track timestamp sections
            if (line.includes('########################')) {
                const nextLine = lines[i + 1];
                if (nextLine && nextLine.match(/\d+\/\d+\/\d+/)) {
                    currentTimestamp = nextLine.trim();
                }
                continue;
            }
            
            // Look for connection lines: [Camera Name] Connection is local network: false IP {
            const connectionMatch = line.match(/\[(.+?)\] Connection is local network: (true|false) ([\d\.]+) \{/);
            if (connectionMatch) {
                const camera = connectionMatch[1];
                const isLocal = connectionMatch[2] === 'true';
                const ip = connectionMatch[3];
                
                // Look ahead for connection type and user agent
                let connectionType = 'unknown';
                let userAgent = '';
                
                for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
                    const nextLine = lines[j];
                    
                    // Extract connection type
                    const typeMatch = nextLine.match(/type: '([^']+)'/);
                    if (typeMatch) {
                        connectionType = typeMatch[1];
                    }
                    
                    // Extract user agent from Client Stream Profile
                    const uaMatch = nextLine.match(/userAgent: '([^']+)'/);
                    if (uaMatch) {
                        userAgent = uaMatch[1];
                        break; // Found what we need
                    }
                }
                
                connections.push({
                    ip,
                    camera,
                    timestamp: currentTimestamp || 'Unknown time',
                    connectionType,
                    userAgent
                });
            }
        }
        
        return connections;
    }
    
    /**
     * Track specific IP address
     */
    trackIP(targetIP: string): ClientConnection[] {
        const allConnections = this.parseRecentConnections();
        return allConnections.filter(conn => conn.ip === targetIP);
    }
    
    /**
     * Get summary for specific IP
     */
    getIPSummary(targetIP: string): string {
        const connections = this.trackIP(targetIP);
        
        if (connections.length === 0) {
            return `No connections found for IP: ${targetIP}`;
        }
        
        const cameras = [...new Set(connections.map(c => c.camera))];
        const connectionType = connections[0]?.connectionType || 'unknown';
        const userAgent = connections[0]?.userAgent || 'Unknown';
        const latestTimestamp = connections[connections.length - 1]?.timestamp;
        
        return [
            `=== Client Tracking Report ===`,
            `IP Address: ${targetIP}`,
            `Connection Type: ${connectionType}`,
            `Latest Activity: ${latestTimestamp}`,
            `User Agent: ${userAgent}`,
            ``,
            `Cameras Accessed (${cameras.length}):`,
            ...cameras.map(camera => `• ${camera}`),
            ``,
            `Total Connection Events: ${connections.length}`
        ].join('\n');
    }
    
    /**
     * Get all unique IPs and their camera counts
     */
    getAllClients(): { [ip: string]: { cameraCount: number, cameras: string[], lastSeen: string } } {
        const allConnections = this.parseRecentConnections();
        const clientSummary: { [ip: string]: { cameraCount: number, cameras: string[], lastSeen: string } } = {};
        
        allConnections.forEach(conn => {
            if (!clientSummary[conn.ip]) {
                clientSummary[conn.ip] = {
                    cameraCount: 0,
                    cameras: [],
                    lastSeen: conn.timestamp
                };
            }
            
            if (!clientSummary[conn.ip].cameras.includes(conn.camera)) {
                clientSummary[conn.ip].cameras.push(conn.camera);
                clientSummary[conn.ip].cameraCount++;
            }
            
            // Update last seen if this timestamp is more recent
            if (conn.timestamp > clientSummary[conn.ip].lastSeen) {
                clientSummary[conn.ip].lastSeen = conn.timestamp;
            }
        });
        
        return clientSummary;
    }
    
    /**
     * Monitor for new connections to specific IP
     */
    startMonitoring(targetIP: string) {
        let lastConnectionCount = this.trackIP(targetIP).length;
        
        const checkForNewConnections = () => {
            const currentConnections = this.trackIP(targetIP);
            
            if (currentConnections.length > lastConnectionCount) {
                const newConnections = currentConnections.slice(lastConnectionCount);
                newConnections.forEach(conn => {
                    console.log(`🚨 New connection from ${targetIP}: ${conn.camera} at ${conn.timestamp}`);
                });
                lastConnectionCount = currentConnections.length;
            }
        };
        
        // Check every 10 seconds
        setInterval(checkForNewConnections, 10000);
        
        console.log(`Started monitoring IP: ${targetIP}`);
        console.log(this.getIPSummary(targetIP));
    }
}

// Create tracker instance
const clientTracker = new WebRTCClientTracker();

// Make available globally
globalThis.clientTracker = clientTracker;

// Example usage functions
console.log('WebRTC Client Tracker loaded. Usage:');
console.log('• clientTracker.trackIP("209.214.192.147")');
console.log('• clientTracker.getIPSummary("209.214.192.147")');
console.log('• clientTracker.getAllClients()');
console.log('• clientTracker.startMonitoring("209.214.192.147")');

export default clientTracker;