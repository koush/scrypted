// Simple test to verify httpFetch headers work correctly
const { httpFetch } = require('@scrypted/common/src/fetch/http-fetch');

async function testHeaders() {
    try {
        console.log('Testing httpFetch with Cloudflare...');
        const response = await httpFetch({
            url: 'https://cloudflare.com',
            responseType: 'text',
            timeout: 10000,
        });
        
        console.log('Response received');
        console.log('Response keys:', Object.keys(response));
        console.log('Headers type:', typeof response.headers);
        console.log('Headers constructor:', response.headers.constructor.name);
        
        // Try to get date header
        const dateHeader = response.headers.get('date');
        console.log('Date header:', dateHeader);
        
        if (dateHeader) {
            const serverTime = new Date(dateHeader).getTime();
            const localTime = Date.now();
            const difference = Math.abs(serverTime - localTime);
            const differenceSeconds = Math.floor(difference / 1000);
            console.log(`Time difference: ${differenceSeconds} seconds`);
        }
        
        // List all headers
        console.log('\nAll headers:');
        response.headers.forEach((value, key) => {
            console.log(`  ${key}: ${value}`);
        });
        
    } catch (error) {
        console.error('Error:', error);
    }
}

testHeaders();