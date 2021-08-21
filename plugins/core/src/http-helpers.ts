import { HttpResponse } from "@scrypted/sdk";

export function sendJSON(res: HttpResponse, json: any) {
    res.send(JSON.stringify(json), {
        headers: {
            'Content-Type': 'application/json',
        }
    })
}