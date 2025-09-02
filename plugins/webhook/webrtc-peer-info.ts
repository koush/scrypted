// Simple WebRTC Peer IP/Hostname Monitor
// Gets peer IP addresses and camera names from active WebRTC connections

class WebRTCPeerMonitor {
    private monitorInterval = null;
    private isRunning = false;
    
    /**
     * Hook WebRTC to capture peer IPs and camera names
     */
    hookWebRTC() {
        const webrtcPlugin = systemManager.getDeviceById('@scrypted/webrtc');
        if (!webrtcPlugin) return;
        
        // Hook connection creation to get camera name
        const originalCreateTrackedFork = webrtcPlugin.createTrackedFork?.bind(webrtcPlugin);
        if (originalCreateTrackedFork && !webrtcPlugin._peerHooked) {
            webrtcPlugin.createTrackedFork = function() {
                const result = originalCreateTrackedFork();
                console.log(`WebRTC connection started for: ${this.mixinDevice?.name || 'Unknown Device'}`);
                return result;
            };
            webrtcPlugin._peerHooked = true;
        }
        
        // Hook Werift configuration to capture peer IPs
        const originalGetWeriftConfig = webrtcPlugin.getWeriftConfiguration?.bind(webrtcPlugin);
        if (originalGetWeriftConfig && !webrtcPlugin._iceHooked) {
            webrtcPlugin.getWeriftConfiguration = async (...args) => {
                const config = await originalGetWeriftConfig(...args);
                
                // Hook ICE candidate filter to log peer IPs
                const originalFilter = config.iceFilterCandidatePair;
                config.iceFilterCandidatePair = (pair) => {
                    const peerIP = pair.remoteCandidate?.host;
                    const connectionType = pair.remoteCandidate?.type;
                    
                    if (peerIP) {
                        console.log(`WebRTC Peer IP: ${peerIP} (${connectionType})`);
                        
                        // Try to resolve hostname
                        this.resolveHostname(peerIP);
                    }
                    
                    return originalFilter ? originalFilter(pair) : true;
                };
                
                return config;
            };
            webrtcPlugin._iceHooked = true;
        }
    }
    
    /**
     * Resolve IP to hostname
     */
    async resolveHostname(ip) {
        try {
            const dns = globalThis.require('dns').promises;
            const hostnames = await dns.reverse(ip);
            console.log(`Hostname: ${ip} -> ${hostnames[0]}`);
        } catch (e) {
            // Hostname resolution failed
        }
    }
    
    /**
     * Get current connection info
     */
    getConnectionInfo() {
        const webrtcPlugin = systemManager.getDeviceById('@scrypted/webrtc');
        const count = webrtcPlugin?.activeConnections || 0;
        
        console.log(`Active WebRTC connections: ${count}`);
        return { count, timestamp: Date.now() };
    }
    
    /**
     * Start monitoring
     */
    start() {
        if (this.isRunning) {
            console.log('WebRTC peer monitoring already running');
            return;
        }
        
        this.hookWebRTC();
        
        // Monitor connection count changes
        let lastCount = 0;
        this.monitorInterval = setInterval(() => {
            const webrtcPlugin = systemManager.getDeviceById('@scrypted/webrtc');
            const currentCount = webrtcPlugin?.activeConnections || 0;
            
            if (currentCount !== lastCount) {
                console.log(`WebRTC connections: ${lastCount} → ${currentCount}`);
                lastCount = currentCount;
            }
        }, 5000);
        
        this.isRunning = true;
        console.log('WebRTC peer monitoring started');
    }
    
    /**
     * Stop monitoring
     */
    stop() {
        if (!this.isRunning) {
            console.log('WebRTC peer monitoring not running');
            return;
        }
        
        if (this.monitorInterval) {
            clearInterval(this.monitorInterval);
            this.monitorInterval = null;
        }
        
        this.isRunning = false;
        console.log('WebRTC peer monitoring stopped');
    }
    
    /**
     * Toggle monitoring on/off
     */
    toggle() {
        if (this.isRunning) {
            this.stop();
        } else {
            this.start();
        }
    }
    
    /**
     * Get current status
     */
    getStatus() {
        return {
            running: this.isRunning,
            connectionCount: this.getConnectionInfo().count
        };
    }
}

// Start monitor
const monitor = new WebRTCPeerMonitor();
monitor.start();

globalThis.webrtcPeerMonitor = monitor;

export default monitor;