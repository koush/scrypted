import { Driver } from "zwave-js";
// Tell the driver which serial port to use
const driver = new Driver("/dev/tty.usbmodem14501");
// You must add a handler for the error event before starting the driver
driver.on("error", (e) => {
    // Do something with it
    console.error(e);
});
// Listen for the driver ready event before doing anything with the driver
driver.once("driver ready", () => {
    /*
    Now the controller interview is complete. This means we know which nodes
    are included in the network, but they might not be ready yet.
    The node interview will continue in the background.
    */

    driver.controller.nodes.forEach(node => console.log(node));

    // After a node was interviewed, it is safe to control it
    // const node = driver.controller.nodes.get(2);
    // node.once("interview completed", async () => {
    //     // e.g. perform a BasicCC::Set with target value 50
    //     await node.commandClasses.Basic.set(50);
    // });
});
// Start the driver. To await this method, put this line into an async method
driver.start();