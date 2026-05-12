const noble = require('@abandonware/noble');

const PLOOM_PREFIXES = ['Ploom X', 'Ploom AURA', 'Ploom aura', 'Ploom cube', 'Ploom X AD'];
const MAIN_SERVICE_UUID = '53654010a3914a6583fabc58084aca28';
const WRITE_CHAR_UUID = '53654011a3914a6583fabc58084aca28';
const NOTIFY_CHAR_UUID = '53654012a3914a6583fabc58084aca28';

console.log("Ploom BLE Test Application Started...");

noble.on('stateChange', async (state) => {
    console.log(`[BLE] State changed to: ${state}`);
    if (state === 'poweredOn') {
        console.log("[BLE] Scanning for Ploom devices...");
        await noble.startScanningAsync([], false);
    } else {
        await noble.stopScanningAsync();
    }
});

noble.on('discover', async (peripheral) => {
    const localName = peripheral.advertisement.localName;
    if (localName) {
        // console.log(`Discovered: ${localName} (${peripheral.address})`);
        const isPloom = PLOOM_PREFIXES.some(prefix => localName.startsWith(prefix));
        
        if (isPloom) {
            console.log(`\n[!] Found Ploom Device: ${localName} (${peripheral.address})`);
            await noble.stopScanningAsync();
            
            try {
                console.log(`[+] Connecting to ${localName}...`);
                await peripheral.connectAsync();
                console.log(`[+] Connected!`);
                
                // Disconnect handler
                peripheral.once('disconnect', () => {
                    console.log(`[-] Disconnected from ${localName}`);
                    process.exit(0);
                });

                console.log(`[+] Discovering services...`);
                const { services } = await peripheral.discoverSomeServicesAndCharacteristicsAsync([MAIN_SERVICE_UUID], []);
                
                if (services.length === 0) {
                    console.log(`[-] Main service not found.`);
                    await peripheral.disconnectAsync();
                    return;
                }
                
                const mainService = services[0];
                console.log(`[+] Found Main Service: ${mainService.uuid}`);
                
                const { characteristics } = await mainService.discoverCharacteristicsAsync([WRITE_CHAR_UUID, NOTIFY_CHAR_UUID]);
                
                let writeChar = null;
                let notifyChar = null;
                
                for (const char of characteristics) {
                    if (char.uuid === WRITE_CHAR_UUID) writeChar = char;
                    if (char.uuid === NOTIFY_CHAR_UUID) notifyChar = char;
                }
                
                if (!writeChar || !notifyChar) {
                    console.log(`[-] Missing required characteristics.`);
                    await peripheral.disconnectAsync();
                    return;
                }
                
                console.log(`[+] Found Write & Notify characteristics!`);
                
                // Subscribe to notifications
                notifyChar.on('data', (data, isNotification) => {
                    console.log(`[<-- RX] Notify: ${data.toString('hex')} (Length: ${data.length})`);
                    parseNotifyData(data);
                });
                
                await notifyChar.subscribeAsync();
                console.log(`[+] Subscribed to Notify characteristic.`);
                
                // Send InitSequence request [2, 227, 0]
                const initCmd = Buffer.from([2, 227, 0]);
                console.log(`[--> TX] Sending InitSequence: ${initCmd.toString('hex')}`);
                await writeChar.writeAsync(initCmd, false);
                
                console.log(`[i] Waiting for responses... (Press Ctrl+C to exit)`);
                
            } catch (err) {
                console.error(`[!] Error:`, err);
                process.exit(1);
            }
        }
    }
});

function parseNotifyData(data) {
    if (data.length < 1) return;
    const opcode = data[0];
    
    switch (opcode) {
        case 0x18: // 24
            console.log(`   --> Device Status (0x18)`);
            break;
        case 0x30: // 48
            console.log(`   --> Connection Response (0x30)`);
            break;
        case 0x33: // 51
            console.log(`   --> Battery Degradation (0x33)`);
            break;
        case 0x47: // 71
            // Version/Variation
            console.log(`   --> Version/Variation (0x47): ${data.toString('utf8', 1)}`);
            break;
        case 0x44: // 68
        case 0x45: // 69
        case 0x46: // 70
            console.log(`   --> Master Correction ${opcode.toString(16)}`);
            break;
        default:
            console.log(`   --> Unknown Opcode: 0x${opcode.toString(16)} (${opcode})`);
    }
}
