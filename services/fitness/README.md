# fitness service

Stub REST microservice. Port: 4003

## Responsibilities
See section 1 of platform spec for this service's role in the FaithFit architecture.

## Run locally
```
npm install
npm start
```

## Docker
```
docker build -t faithfit-fitness .
docker run -p 4003:4003 faithfit-fitness
```
