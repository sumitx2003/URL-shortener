const { encodeBase62, decodeBase62 } = require("./base62");

const id = 1001;

const shortCode = encodeBase62(id);
const decodedId = decodeBase62(shortCode);

console.log("Original ID:", id);
console.log("Short code:", shortCode);
console.log("Decoded ID:", decodedId);


// import { createClient } from 'redis';

// const client = createClient({
//     username: 'default',
//     password: '3sOTU6VVgyiFP03N5HIYHjbaJLycqB8n',
//     socket: {
//         host: 'pure-ultimate-lovely-26772.db.redis.io',
//         port: 12503
//     }
// });

// client.on('error', err => console.log('Redis Client Error', err));

// await client.connect();

// await client.set('foo', 'bar');
// const result = await client.get('foo');
// console.log(result)  // >>> bar

