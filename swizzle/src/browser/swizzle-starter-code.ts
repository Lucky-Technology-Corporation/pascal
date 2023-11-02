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

export function starterComponent(fileName: string, hasAuth: boolean){
    const authImport = `import {useAuthUser} from 'react-auth-kit'
`

    return `import React from 'react';
${hasAuth ? authImport : ''}
const ${fileName} = () => {
    ${hasAuth ? `const auth = useAuthUser();` : ''}
    return (
        <div>
            {/* Your content here */}
        </div>
    );
};

export default ${fileName};`
}

export function starterHelper(fileName: string){
    return `export default function ${fileName}(){

}`
}