// WebRTC IP Connection Tracker Script
// Runs in Core plugin context with globals available

interface ConnectionInfo {
    id: string;
    startTime: number;
    remoteIP: string | null;
    hostname: string | null;
    userAgent: string | null;
    clientType: string;
    connectionType?: string;
    relatedIP?: string;
    lastSeen: number;
}

class WebRTCIPTracker {
    private connections = new Map<string, ConnectionInfo>();
    private cleanupInterval: NodeJS.Timeout | null = null;
    private monitorInterval: NodeJS.Timeout | null = null;
    
    init() {
        this.hookWebRTCPlugin();
        this.startConnectionMonitoring();
        this.startCleanupTask();
        console.log('WebRTC IP Tracker initialized');
    }
    
    destroy() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
        if (this.monitorInterval) {
            clearInterval(this.monitorInterval);
            this.monitorInterval = null;
        }
        this.connections.clear();
        console.log('WebRTC IP Tracker destroyed');
    }
    
    private startCleanupTask() {
        // Clean up stale connections every 30 seconds
        this.cleanupInterval = setInterval(() => {
            this.cleanupStaleConnections();
        }, 30000);
    }
    
    private cleanupStaleConnections() {
        const now = Date.now();
        const staleThreshold = 5 * 60 * 1000; // 5 minutes
        let cleaned = 0;
        
        for (const [id, conn] of this.connections) {
            if (now - conn.lastSeen > staleThreshold) {
                this.connections.delete(id);
                cleaned++;
                console.log(`Cleaned up stale connection: ${id}`);
            }
        }
        
        if (cleaned > 0) {
            console.log(`Cleaned up ${cleaned} stale connections. Active: ${this.connections.size}`);
        }
    }
    
    private hookWebRTCPlugin() {
        try {
            // Get WebRTC plugin using available globals (sdk.systemManager in script context)
            const webrtcPlugin = sdk.systemManager.getDeviceById('@scrypted/webrtc');
            if (!webrtcPlugin) {
                console.log('WebRTC plugin not found');
                return;
            }
            
            console.log('Found WebRTC plugin, hooking into connection creation');
            
            // Store original method
            const originalCreateTrackedFork = webrtcPlugin.createTrackedFork?.bind(webrtcPlugin);
            
            if (originalCreateTrackedFork) {
                // Override the connection creation method
                webrtcPlugin.createTrackedFork = () => {
                    const result = originalCreateTrackedFork();
                    
                    const connectionInfo: ConnectionInfo = {
                        id: this.generateId(),
                        startTime: Date.now(),
                        lastSeen: Date.now(),
                        remoteIP: null,
                        hostname: null,
                        userAgent: null,
                        clientType: 'unknown'
                    };
                    
                    this.connections.set(connectionInfo.id, connectionInfo);
                    console.log('New WebRTC connection tracked:', connectionInfo.id);
                    
                    // Monitor when connection ends
                    result.worker.on('exit', () => {
                        console.log('WebRTC connection ended:', connectionInfo.id);
                        this.connections.delete(connectionInfo.id);
                    });
                    
                    return result;
                };
                
                console.log('Successfully hooked WebRTC createTrackedFork');
            }
            
        } catch (e) {
            console.error('Failed to hook WebRTC plugin:', e);
        }
    }
    
    private startConnectionMonitoring() {
        // Monitor connection count changes and sync with actual count
        let lastCount = 0;
        
        this.monitorInterval = setInterval(() => {
            try {
                const webrtcPlugin = sdk.systemManager.getDeviceById('@scrypted/webrtc');
                const currentCount = webrtcPlugin?.activeConnections || 0;
                
                // If our tracked count is much higher than actual, clean up
                if (this.connections.size > currentCount + 2) {
                    console.log(`Connection count mismatch: tracked=${this.connections.size}, actual=${currentCount}. Cleaning up.`);
                    this.syncWithActualConnections(currentCount);
                }
                
                if (currentCount !== lastCount) {
                    console.log(`WebRTC connections: ${lastCount} → ${currentCount}`);
                    this.logConnectionSummary();
                    lastCount = currentCount;
                }
            } catch (e) {
                console.error('Error monitoring connections:', e);
            }
        }, 2000);
    }
    
    private syncWithActualConnections(actualCount: number) {
        // If we have more tracked connections than actual, remove the oldest ones
        const excess = this.connections.size - actualCount;
        if (excess > 0) {
            const connectionsByAge = Array.from(this.connections.entries())
                .sort((a, b) => a[1].startTime - b[1].startTime);
            
            for (let i = 0; i < excess; i++) {
                const [id] = connectionsByAge[i];
                this.connections.delete(id);
                console.log(`Removed excess connection: ${id}`);
            }
        }
    }
    
    private logConnectionSummary() {
        const active = Array.from(this.connections.values());
        console.log('Tracked connections:', active.length);
        
        active.forEach(conn => {
            const duration = Math.round((Date.now() - conn.startTime) / 1000);
            console.log(`  ${conn.id}: ${conn.remoteIP || 'pending IP'} (${duration}s) ${conn.clientType}`);
        });
    }
    
    private generateId(): string {
        return Math.random().toString(36).substring(2, 9);
    }
    
    // Public methods for webhook access
    getActiveConnections() {
        return Array.from(this.connections.values()).map(conn => ({
            id: conn.id,
            startTime: conn.startTime,
            duration: Date.now() - conn.startTime,
            remoteIP: conn.remoteIP,
            hostname: conn.hostname,
            clientType: conn.clientType,
            userAgent: conn.userAgent
        }));
    }
    
    getConnectionCount() {
        try {
            const webrtcPlugin = sdk.systemManager.getDeviceById('@scrypted/webrtc');
            return webrtcPlugin?.activeConnections || 0;
        } catch (e) {
            return 0;
        }
    }
    
    getConnectionsByType() {
        const connections = this.getActiveConnections();
        const byType = {};
        
        connections.forEach(conn => {
            byType[conn.clientType] = (byType[conn.clientType] || 0) + 1;
        });
        
        return byType;
    }
}

// Enhanced version with IP extraction
class AdvancedWebRTCTracker extends WebRTCIPTracker {
    
    hookWebRTCPlugin() {
        super.hookWebRTCPlugin();
        this.hookICECandidates();
    }
    
    private hookICECandidates() {
        try {
            const webrtcPlugin = sdk.systemManager.getDeviceById('@scrypted/webrtc');
            if (!webrtcPlugin) return;
            
            // Hook into Werift configuration to capture ICE data
            const originalGetWeriftConfig = webrtcPlugin.getWeriftConfiguration?.bind(webrtcPlugin);
            
            if (originalGetWeriftConfig) {
                webrtcPlugin.getWeriftConfiguration = async (...args: any[]) => {
                    const config = await originalGetWeriftConfig(...args);
                    
                    // Hook the ICE candidate filter
                    const originalFilter = config.iceFilterCandidatePair;
                    config.iceFilterCandidatePair = (pair: any) => {
                        this.processICECandidate(pair);
                        return originalFilter ? originalFilter(pair) : true;
                    };
                    
                    return config;
                };
                
                console.log('Successfully hooked ICE candidate processing');
            }
            
        } catch (e) {
            console.error('Failed to hook ICE candidates:', e);
        }
    }
    
    private processICECandidate(pair: any) {
        const remoteIP = pair.remoteCandidate?.host;
        const connectionType = pair.remoteCandidate?.type;
        const relatedIP = pair.remoteCandidate?.relatedAddress;
        
        if (remoteIP) {
            console.log('ICE Candidate:', {
                remoteIP,
                connectionType, // 'host', 'srflx', 'relay'
                relatedIP
            });
            
            // Find recent connection to update with IP
            this.updateConnectionWithIP(remoteIP, connectionType, relatedIP);
            
            // Async hostname resolution
            this.resolveHostname(remoteIP);
        }
    }
    
    private updateConnectionWithIP(remoteIP: string, connectionType: string, relatedIP: string) {
        // Find the most recent connection without an IP
        for (const [id, conn] of this.connections) {
            if (!conn.remoteIP && Date.now() - conn.startTime < 30000) {
                conn.remoteIP = remoteIP;
                conn.connectionType = connectionType;
                conn.relatedIP = relatedIP;
                conn.lastSeen = Date.now(); // Update last seen when we get IP info
                
                console.log(`Updated connection ${id} with IP: ${remoteIP} (${connectionType})`);
                break;
            }
        }
    }
    
    private async resolveHostname(ip: string) {
        // Use Node.js DNS (available in Core plugin context)
        try {
            // In Scrypted script context, we can access Node.js modules directly
            const dns = globalThis.require('dns').promises;
            const hostnames = await dns.reverse(ip);
            
            // Update connections with this IP
            for (const [id, conn] of this.connections) {
                if (conn.remoteIP === ip && !conn.hostname) {
                    conn.hostname = hostnames[0];
                    console.log(`Resolved ${ip} -> ${hostnames[0]} for connection ${id}`);
                }
            }
        } catch (e) {
            // Hostname resolution failed - this is normal for many IPs
        }
    }
}

// Global instance available to other scripts and webhooks
const webrtcTracker = new AdvancedWebRTCTracker();
webrtcTracker.init();

// Make it available globally for webhook access
globalThis.webrtcTracker = webrtcTracker;

// Webhook handlers can now use:
// - webrtcTracker.getActiveConnections()
// - webrtcTracker.getConnectionCount()  
// - webrtcTracker.getConnectionsByType()

console.log('WebRTC IP Tracker script loaded. Use globalThis.webrtcTracker to access.');

// Export for use as a Scrypted script device
export default webrtcTracker;