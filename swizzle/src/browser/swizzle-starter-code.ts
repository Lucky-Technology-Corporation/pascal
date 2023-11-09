export function starterEndpoint(method: string, endpoint: string){
    const fileContent = 
`import express, { Response } from "express";
import { AuthenticatedRequest, optionalAuthentication } from "swizzle-js";
const router = express.Router();

router.${method}('${endpoint}', optionalAuthentication, async (request: AuthenticatedRequest, response: Response) => {
    //Your code goes here
    return response.json({ message: "It works!" });
});

export default router;`

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

export function starterComponent(fileName: string, hasAuth: boolean, path: string){
    const levels = path.split('/').length - 1;
    const apiImport = '../'.repeat(levels) + 'Api';
    
    return `import React from 'react';
import api from '${apiImport}'; //Use this to make API calls (e.g. await api.get("/endpoint"))

const ${fileName} = () => {
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