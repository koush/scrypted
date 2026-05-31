import { Socket } from 'dgram'
import { AddressInfo } from 'net'
import { pickPort } from 'pick-port'

// Need to reserve ports in sequence because ffmpeg uses the next port up by default.  If it's taken, ffmpeg will error
export async function reservePorts({
  count = 1,
  type = 'udp',
  attemptNumber = 0,
}: {
  count?: number
  type?: 'udp' | 'tcp'
  attemptNumber?: number
} = {}): Promise<number[]> {
  if (attemptNumber > 100) {
    throw new Error('Failed to reserve ports after 100 tries')
  }

  const pickPortOptions = {
      type,
      reserveTimeout: 15, // 15 seconds is max setup time for HomeKit streams, so the port should be in use by then
    },
    port = await pickPort(pickPortOptions),
    ports = [port],
    tryAgain = () => {
      return reservePorts({
        count,
        type,
        attemptNumber: attemptNumber + 1,
      })
    }

  for (let i = 1; i < count; i++) {
    try {
      const targetConsecutivePort = port + i,
        openPort = await pickPort({
          ...pickPortOptions,
          minPort: targetConsecutivePort,
          maxPort: targetConsecutivePort,
        })

      ports.push(openPort)
    } catch (_) {
      // can't reserve next port, bail and get another set
      return tryAgain()
    }
  }

  return ports
}

export function bindToPort(socket: Socket) {
  return new Promise<number>((resolve, reject) => {
    socket.on('error', reject)

    // 0 means select a random open port
    socket.bind(0, () => {
      const { port } = socket.address() as AddressInfo
      resolve(port)
    })
  })
}
