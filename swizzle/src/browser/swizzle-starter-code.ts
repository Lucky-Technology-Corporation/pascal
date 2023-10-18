export function starterEndpoint(method: string, endpoint: string){
    const fileContent = 
`const express = require('express');
const router = express.Router();
const { optionalAuthentication, requiredAuthentication } = require('swizzle-js');

router.${method}('${endpoint}', optionalAuthentication, async (request, response) => {
    //Your code goes here
    return response.json({ message: "It works!" });
});

module.exports = router;`

    return fileContent;
}

export function starterHTML(){
    const fileContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Title</title>
</head>
<body>

  <!-- Your content here -->

</body>
</html>`
    return fileContent;
}

export function starterCSS(){
    const fileContent = `/* Your CSS here */`
    return fileContent;
}