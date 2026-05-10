const axios = require('axios');

async function test() {
  try {
    const res = await axios.post('http://localhost:3000/api/github/parse', {
      url: 'https://google.com'
    });
    console.log('Success:', res.data);
  } catch (err) {
    console.log('Error:', err.response?.status, err.response?.data);
  }
}

test();
