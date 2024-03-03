if __name__ == "__main__":
    import telnetlib
    import sys
    import signal

    host = sys.argv[1]
    port = int(sys.argv[2])

    with telnetlib.Telnet(host, port) as tn:
        def sigint_handler(signum, frame):
            tn.write(b"\x03")
        signal.signal(signal.SIGINT, sigint_handler)
        tn.interact()