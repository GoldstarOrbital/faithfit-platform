# auth service

Stub REST microservice. Port: 4001

## Responsibilities
See section 1 of platform spec for this service's role in the FaithFit architecture.

## Run locally
```
npm install
npm start
```

## Docker
```
docker build -t faithfit-auth .
docker run -p 4001:4001 faithfit-auth
```
