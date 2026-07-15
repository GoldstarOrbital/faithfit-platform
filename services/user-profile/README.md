# user-profile service

Stub REST microservice. Port: 4002

## Responsibilities
See section 1 of platform spec for this service's role in the FaithFit architecture.

## Run locally
```
npm install
npm start
```

## Docker
```
docker build -t faithfit-user-profile .
docker run -p 4002:4002 faithfit-user-profile
```
